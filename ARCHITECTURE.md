# Arquitetura do TicketFlow

## 1. Visão geral

```
                ┌──────────────┐
  Usuário ────▶ │  Frontend    │  Next.js (Vercel)
                │  + BFF /api  │  rewrites → API (cookie first-party)
                └──────┬───────┘
                       │ REST/JSON
                ┌──────▼───────┐  mesma transação   ┌────────────────────┐
                │  API         │───────────────────▶│ PostgreSQL         │
                │  (NestJS)    │                    │ eventos, pedidos,  │
                └──┬───────────┘                    │ outbox, stripe_... │
                   │                                └─────────▲──────────┘
        cria sessão│                                          │ lê outbox (SKIP LOCKED)
                   │   ┌─────────┐   ┌──────────────────────┐ │
                   │   │ Redis   │◀─▶│ Worker (Nest         │─┘
                   │   │ + BullMQ│   │ standalone): relay,  │──▶ E-mail (Resend / Mailpit)
                   │   └─────────┘   │ e-mail, expiração,   │──▶ Stripe API (expire,
                   ▼                 │ reconciliação        │     refund, retrieve)
              ┌─────────┐            └──────────────────────┘
              │ Stripe  │
              │Checkout │
              └────┬────┘
                   │ webhook assinado
                   └────────▶ POST /webhooks/stripe
```

Princípios:

- **O Postgres é a fonte da verdade.** Redis/BullMQ é só transporte de trabalho: se o Redis
  for zerado, nada se perde, porque os jobs nascem da tabela `outbox`.
- **O webhook do Stripe confirma pagamentos**, nunca o front-end.
- **Nenhuma chamada HTTP externa dentro de transação de banco.**

## 2. Estrutura do monorepo

pnpm workspaces + **Turborepo** (cache e ordem de execução das tasks entre pacotes).
Runtime: **Node 24 LTS**.

```
ticketflow/
├── apps/
│   ├── web/                 # Next.js (App Router) + BFF via rewrites
│   ├── api/                 # NestJS (HTTP)
│   └── worker/              # NestJS standalone (createApplicationContext) + @nestjs/bullmq
├── packages/
│   ├── db/                  # Prisma schema, migrations (com SQL manual dos CHECKs), client
│   ├── domain/              # regras puras: máquina de estados, reserva/expiração, erros de domínio
│   ├── contracts/           # schemas zod e tipos compartilhados (DTOs, payloads de jobs)
│   └── config/              # tsconfig base, ESLint (flat config), Prettier, Vitest preset
├── docs/
│   ├── adr/                 # decisões de arquitetura
│   └── images/              # diagramas e GIFs
├── .github/
│   ├── workflows/{ci.yml,deploy.yml}
│   └── renovate.json        # atualização automática de dependências
├── docker-compose.yml
├── turbo.json
├── .env.example
├── CLAUDE.md
├── ARCHITECTURE.md
├── PROMPTS.md
├── ROADMAP.md
└── README.md
```

**Regra de dependência:** `apps/*` dependem de `packages/*`; `domain` não depende de NestJS
nem de Prisma diretamente (recebe repositórios por interface). API e worker usam o mesmo
código de domínio; nenhuma regra é duplicada.

## 3. Modelo de dados

Todos os valores monetários em **centavos** (inteiro). Datas gravadas em UTC
(`timestamptz`); exibição no fuso do evento.

| Tabela           | Campos principais                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`          | id, email (unique), password_hash, name, roles (`BUYER`, `ORGANIZER`; array, um usuário pode ter os dois), created_at                                                                                                                                                          |
| `refresh_tokens` | id, user_id → users, token_hash (unique), expires_at, revoked_at (nullable), replaced_by (nullable)                                                                                                                                                                            |
| `events`         | id, organizer_id → users, title, description, venue, **timezone** (IANA, ex. `America/Sao_Paulo`), starts_at, status (`DRAFT` \| `PUBLISHED` \| `CANCELLED`), cancelled_at, created_at                                                                                         |
| `ticket_types`   | id, event_id → events, name, price_cents, total, available, sales_start, sales_end, max_per_order. **CHECK (available >= 0 AND available <= total)**, **CHECK (price_cents >= 0)**                                                                                             |
| `orders`         | id, user_id → users, status, total_cents, currency (`BRL`), idempotency_key (nullable), request_hash (nullable), stripe_session_id (unique, nullable), stripe_payment_intent_id (nullable), expires_at, paid_at, created_at, updated_at. **UNIQUE (user_id, idempotency_key)** |
| `order_items`    | id, order_id → orders, ticket_type_id → ticket_types, quantity (CHECK > 0), unit_price_cents                                                                                                                                                                                   |
| `tickets`        | id, order_id → orders, ticket_type_id, **event_id** → events (desnormalizado para o check-in), qr_token (unique, aleatório), emailed_at (nullable), checked_in_at (nullable), voided_at (nullable)                                                                             |
| `stripe_events`  | event_id (PK, id do evento Stripe), type, processed_at                                                                                                                                                                                                                         |
| `outbox`         | id, type (ex. `send-ticket-email`), payload (jsonb), created_at, published_at (nullable), attempts                                                                                                                                                                             |

Índices:

- `orders(expires_at) WHERE status = 'PENDING'` (índice **parcial** para o job de expiração)
- `orders(user_id, created_at)` para "meus pedidos"
- `tickets(qr_token)` (unique), `tickets(order_id)`
- `events(status, starts_at)`
- `outbox(created_at) WHERE published_at IS NULL`

## 4. Estados do pedido

```
PENDING ──pago (cartão)──────────────────────────────▶ PAID ──reembolso──▶ REFUND_PENDING ──▶ REFUNDED
   │                                                    ▲                       ▲
   ├──sessão concluída, pagamento assíncrono (Pix)──▶ PROCESSING                │
   │                                    │  └──pago──────┘                       │
   │                                    └──falhou──▶ EXPIRED                    │
   ├──expirou (job / webhook)─────────────────────▶ EXPIRED                     │
   │                                                 ├──pagamento tardio, com estoque──▶ PAID
   │                                                 └──pagamento tardio, sem estoque──┘
   └──cancelado pelo usuário──────────────────────▶ CANCELLED
```

| De               | Para             | Gatilho                                                          |
| ---------------- | ---------------- | ---------------------------------------------------------------- |
| `PENDING`        | `PAID`           | `checkout.session.completed` com `payment_status = paid`         |
| `PENDING`        | `PROCESSING`     | `checkout.session.completed` com `payment_status = unpaid` (Pix) |
| `PROCESSING`     | `PAID`           | `checkout.session.async_payment_succeeded`                       |
| `PROCESSING`     | `EXPIRED`        | `checkout.session.async_payment_failed` (devolve estoque)        |
| `PENDING`        | `EXPIRED`        | job de expiração ou `checkout.session.expired` (devolve estoque) |
| `PENDING`        | `CANCELLED`      | usuário cancela (expira a sessão no Stripe e devolve estoque)    |
| `EXPIRED`        | `PAID`           | pagamento tardio e o estoque ainda existe (re-reserva)           |
| `EXPIRED`        | `REFUND_PENDING` | pagamento tardio sem estoque (reembolso automático)              |
| `PAID`           | `REFUND_PENDING` | reembolso solicitado (organizador ou evento cancelado)           |
| `REFUND_PENDING` | `REFUNDED`       | `charge.refunded` (tickets ficam com `voided_at`)                |

A máquina de estados vive em `packages/domain`. Transições fora desta tabela lançam
`InvalidOrderTransitionError`. Toda transição acontece dentro de uma transação e é testada.
Pedidos em `PROCESSING` **não** são expirados pelo job: o estoque fica reservado até o
Stripe confirmar ou recusar o pagamento.

## 5. Fluxo de pagamento

1. **Checkout**: `POST /orders` com itens `[ {ticketTypeId, quantity} ]` e header opcional
   `Idempotency-Key`. Validações antes de reservar: evento `PUBLISHED`, agora entre
   `sales_start` e `sales_end`, `quantity <= max_per_order`, itens sem repetição.
   Em **uma transação**: reserva o estoque (seção 6), cria `orders` (`PENDING`,
   `expires_at = now + RESERVATION_TTL`) e `order_items`, e faz commit.
2. **Sessão Stripe** (fora da transação): a API cria a Checkout Session (`mode: payment`,
   `line_items` a partir do pedido, `metadata.order_id`, `client_reference_id = order.id`,
   `expires_at` do pedido respeitando o mínimo de 30 min do Stripe, `success_url` e
   `cancel_url`), passando **`idempotencyKey: order.id`** para que uma retentativa não crie
   uma segunda sessão. Grava `stripe_session_id` e devolve `{ orderId, checkoutUrl }`.
   - Se a criação falhar, compensa: pedido `CANCELLED` e estoque devolvido.
   - Se o processo cair entre o commit e a chamada ao Stripe, o pedido fica `PENDING` sem
     `stripe_session_id`; o job de expiração trata esse caso (não há sessão para expirar).
3. **Pagamento**: o usuário paga na página hospedada do Stripe.
4. **Webhook** `POST /webhooks/stripe`:
   - Valida a assinatura usando o **corpo cru (raw body)** e `STRIPE_WEBHOOK_SECRET`.
     Assinatura inválida → 400.
   - Abre **uma única transação** que contém:
     1. `INSERT INTO stripe_events (event_id, ...)`. Violação de UNIQUE → evento já
        processado: rollback e responde 200.
     2. A mudança de estado do pedido (`SELECT ... FOR UPDATE` no pedido).
     3. A criação dos `tickets`, quando aplicável.
     4. O `INSERT` na `outbox` (ex. `send-ticket-email`).
   - Se qualquer passo falhar, tudo é revertido (inclusive o registro em `stripe_events`) e a
     resposta é **5xx**, para o Stripe reenviar o evento. Nunca registrar o evento como
     processado sem processar.
   - Eventos tratados: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
     Demais tipos: grava em `stripe_events` e responde 200.
   - Responde 200 rápido; trabalho pesado (QR code, e-mail) sai pela outbox.
5. **Página de sucesso**: apenas consulta `GET /orders/:id` e mostra o status atual.
   Se ainda `PENDING`/`PROCESSING`, faz polling por alguns segundos. **Nunca** marca como pago.
6. **Expiração (job `expire-orders`, a cada minuto)**: busca pedidos `PENDING` com
   `expires_at < now()` em lotes (`FOR UPDATE SKIP LOCKED`). Para cada um, **primeiro**
   chama `stripe.checkout.sessions.expire(...)`:
   - Sucesso, ou sessão já expirada, ou pedido sem sessão → marca `EXPIRED` e devolve o
     estoque (transação).
   - Stripe responde que a sessão está `complete` → **não** libera estoque; busca a sessão
     (`sessions.retrieve`) e aplica o mesmo handler do webhook (o pagamento venceu a corrida).
   - Erro transitório do Stripe → deixa para a próxima execução.
7. **Reconciliação (job `reconcile-stripe`, a cada 15 min)**: para pedidos `PENDING` ou
   `PROCESSING` com sessão criada há mais de 10 min, consulta a sessão no Stripe e aplica o
   mesmo handler do webhook. Recupera webhooks perdidos (deploy, endpoint fora do ar).

### Sobre o TTL da reserva

A Checkout Session do Stripe exige `expires_at` **entre 30 minutos e 24 horas** a partir da
criação. `RESERVATION_TTL_MINUTES` tem padrão de **30**. Para uma reserva mais curta
(ex.: 15 min), a sessão continua com 30 min e o job de expiração a encerra via
`sessions.expire` quando o pedido vence. Como o job expira a sessão **antes** de devolver o
estoque, uma sessão expirada não pode mais ser paga com cartão.

### Caso de borda: pagamento chega depois da expiração

Com a ordem "expira no Stripe, depois devolve o estoque", esse caso fica raro, mas continua
possível (ex.: alguém expira o pedido manualmente no banco, ou um bug). Se um evento de
pagamento confirmado chegar para um pedido já `EXPIRED`:

- Tentar reservar o estoque novamente. Se houver, marcar `PAID` e emitir os ingressos.
- Se não houver, marcar `REFUND_PENDING`, gravar na outbox um job `refund-order` (que chama
  `stripe.refunds.create` com `idempotencyKey = refund:<order.id>`) e registrar log `warn`
  explícito. O pedido vira `REFUNDED` quando chegar `charge.refunded`.
- Este cenário precisa de teste de integração.

### Cancelamento de evento

Quando o organizador cancela um evento `PUBLISHED`: o evento vira `CANCELLED` (novas vendas
bloqueadas), os pedidos `PENDING` são expirados e, para cada pedido `PAID`, é gravado um job
`refund-order` na outbox, na mesma transação. Os compradores recebem e-mail de cancelamento.

## 6. Controle de estoque (anti-overselling)

Decremento atômico, sem ler-e-depois-escrever. Com Prisma, sem SQL cru:

```ts
const { count } = await tx.ticketType.updateMany({
  where: { id, available: { gte: qty } },
  data: { available: { decrement: qty } },
});
if (count === 0) throw new InsufficientStockError(id);
```

SQL equivalente: `UPDATE ticket_types SET available = available - :qty WHERE id = :id AND available >= :qty`.

- Com vários itens no mesmo pedido, processar em **ordem determinística** (por id) para
  evitar deadlocks.
- A constraint `CHECK (available >= 0 AND available <= total)` é a segunda linha de defesa.
  O Prisma não gera CHECK: ela entra como SQL manual na migration.
- Devolução de estoque usa `increment` e só acontece junto com a transição de estado do
  pedido (mesma transação), o que garante que acontece uma vez só.
- **Teste obrigatório**: N compras concorrentes (ex.: 50) disputando M ingressos (ex.: 10).
  Resultado esperado: exatamente M pedidos criados e `available = 0`.

## 7. Idempotência e consistência

- **Webhooks**: `stripe_events` com PK em `event_id`, gravado **na mesma transação** do
  processamento (seção 5).
- **Criação de pedido**: header opcional `Idempotency-Key`, gravado em
  `orders(user_id, idempotency_key)` com UNIQUE e um `request_hash` (SHA-256 do corpo
  normalizado). Mesma chave e mesmo corpo → devolve o pedido existente. Mesma chave e corpo
  diferente → `422`.
- **Chamadas ao Stripe**: toda chamada que cria algo usa `idempotencyKey` derivada do
  pedido (`order.id`, `refund:<order.id>`).
- **Outbox (transactional outbox)**: nenhum código de API ou webhook enfileira direto no
  BullMQ. Ele grava uma linha em `outbox` na mesma transação da mudança de negócio. O
  **relay** (no worker) lê linhas com `published_at IS NULL` (`FOR UPDATE SKIP LOCKED`),
  publica no BullMQ com **`jobId = outbox.id`** (o BullMQ ignora jobId duplicado) e marca
  `published_at`. Garantia resultante: _at-least-once_; por isso os jobs são idempotentes.
- **Jobs**: podem rodar mais de uma vez sem efeito colateral. O e-mail só é enviado para
  tickets com `emailed_at IS NULL`, e `emailed_at` é gravado logo após o envio.

## 8. Jobs (BullMQ, no worker)

| Fila / job              | Gatilho                                                                   | O que faz                                                       |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `outbox-relay`          | loop contínuo (~1 s)                                                      | publica linhas pendentes da `outbox` no BullMQ                  |
| `send-ticket-email`     | outbox (pedido virou `PAID`)                                              | gera QR code (PNG) de cada ticket e envia e-mail                |
| `refund-order`          | outbox (pagamento tardio sem estoque, evento cancelado, reembolso manual) | chama `stripe.refunds.create` com chave de idempotência         |
| `expire-orders`         | repetível, 1/min                                                          | expira sessões no Stripe e depois os pedidos (seção 5, passo 6) |
| `reconcile-stripe`      | repetível, a cada 15 min                                                  | recupera webhooks perdidos (seção 5, passo 7)                   |
| `send-reminder` (extra) | 24h antes do evento                                                       | lembrete para compradores                                       |

- Tentativas com backoff exponencial. Ao esgotar, o job fica em `failed` (a "dead-letter"
  do BullMQ) e gera log `error`. Job repetível usa `jobId` fixo, então múltiplas instâncias
  do worker não duplicam o agendamento.
- Shutdown gracioso: no `SIGTERM`, `worker.close()` espera os jobs em andamento.
- O worker é uma aplicação **NestJS standalone** (`NestFactory.createApplicationContext`) e
  reutiliza os mesmos módulos de domínio, Prisma e Stripe da API.

## 9. API (resumo)

| Método            | Rota                                        | Auth              | Descrição                               |
| ----------------- | ------------------------------------------- | ----------------- | --------------------------------------- |
| POST              | `/auth/register`, `/auth/login`             | pública           | cadastro e login (define cookies)       |
| POST              | `/auth/refresh`, `/auth/logout`             | cookie de refresh | rotação e revogação do refresh token    |
| GET               | `/me`                                       | autenticado       | dados e papéis do usuário               |
| GET               | `/events`, `/events/:id`                    | pública           | lista e detalha eventos publicados      |
| POST/PATCH/DELETE | `/events`, `/events/:id`                    | ORGANIZER (dono)  | gerencia eventos próprios               |
| POST              | `/events/:id/publish`, `/events/:id/cancel` | ORGANIZER (dono)  | publica / cancela (seção 5)             |
| POST/PATCH        | `/events/:id/ticket-types`                  | ORGANIZER (dono)  | gerencia lotes                          |
| POST              | `/orders`                                   | BUYER             | cria pedido e sessão de checkout        |
| GET               | `/orders/:id`                               | dono              | status do pedido                        |
| POST              | `/orders/:id/cancel`                        | dono              | cancela pedido `PENDING`                |
| GET               | `/me/tickets`                               | BUYER             | ingressos comprados                     |
| POST              | `/webhooks/stripe`                          | assinatura Stripe | recebe eventos do Stripe                |
| POST              | `/events/:id/check-in`                      | ORGANIZER (dono)  | valida QR e marca check-in (uma vez só) |
| GET               | `/events/:id/sales`                         | ORGANIZER (dono)  | métricas de vendas                      |
| GET               | `/health/live`, `/health/ready`             | pública           | liveness / readiness (banco e Redis)    |

Documentação OpenAPI/Swagger em `/docs`; o JSON em `/docs-json` alimenta a geração de tipos
do front-end.

**Check-in** é atômico:

```sql
UPDATE tickets SET checked_in_at = now()
WHERE qr_token = :token AND event_id = :eventId
  AND checked_in_at IS NULL AND voided_at IS NULL;
```

`rowCount = 1` → válido. `rowCount = 0` → consulta o ticket para responder "já utilizado",
"cancelado" ou "não pertence a este evento".

## 10. Segurança

- Senhas com **argon2id**.
- **Sessão em cookies httpOnly**: access token JWT curto (15 min) e refresh token opaco
  (7 dias, guardado como hash em `refresh_tokens`, rotacionado a cada uso; reuso de token
  revogado revoga a família inteira). `Secure`, `SameSite=Lax`.
- **Front e API no mesmo site**: o Next.js expõe `/api/*` via `rewrites` para a API (BFF).
  O navegador só fala com o domínio do front, então o cookie é first-party e não depende de
  cookies de terceiros. Alternativa: domínio próprio com `app.` e `api.` no mesmo domínio.
- Proteção CSRF: `SameSite=Lax` + checagem de `Origin` nas rotas que alteram estado.
- Rate limiting com `@nestjs/throttler` usando **storage em Redis** (vale para várias
  instâncias) em `/auth/*` e `/orders`.
- CORS restrito ao domínio do front. Helmet ativado.
- Autorização por recurso (organizador só mexe nos próprios eventos; comprador só vê os
  próprios pedidos). Recurso de outro dono → `404` (não revela existência).
- `qr_token` aleatório e não sequencial (32 bytes em base64url).
- Segredos só via variáveis de ambiente, validadas no boot com zod (app não sobe com
  configuração inválida). `gitleaks` e Trivy (filesystem e imagens) no CI.

## 11. Variáveis de ambiente

O arquivo de referência é o `.env.example` da raiz. Em dev, api e worker carregam o `.env`
da raiz no boot e validam as variáveis com zod (`apps/*/src/config/env.ts`); cada app exige
só as variáveis que usa.

```
NODE_ENV=development
LOG_LEVEL=info

# API / Worker
API_PORT=3000
DATABASE_URL=postgresql://ticketflow:ticketflow@localhost:5432/ticketflow
DIRECT_URL=postgresql://ticketflow:ticketflow@localhost:5432/ticketflow  # migrations (sem pooler)
REDIS_URL=redis://localhost:6379
JWT_SECRET=troque-isto-por-um-segredo-com-32-caracteres-ou-mais   # mínimo 32 caracteres
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESERVATION_TTL_MINUTES=30
APP_URL=http://localhost:3001
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM=ingressos@ticketflow.local
RESEND_API_KEY=            # produção (opcional)
OTEL_EXPORTER_OTLP_ENDPOINT=   # opcional

# Web
API_URL=http://localhost:3000   # destino dos rewrites /api/* (server-side, não exposto ao browser)
```

## 12. Observabilidade

- Logs JSON com `nestjs-pino`, incluindo `request_id`, `order_id` e `job_id`.
- **OpenTelemetry**: traces da API, do Prisma e do BullMQ, com o contexto propagado no
  payload da outbox, de modo que um pedido pode ser seguido de ponta a ponta
  (HTTP → webhook → outbox → job → e-mail).
- `GET /health/live` e `/health/ready` (`@nestjs/terminus`, verificando banco e Redis).
- Métricas opcionais com Prometheus (`/metrics`): pedidos por status, tamanho da outbox
  pendente, jobs falhos.

## 13. Estratégia de testes

Runner: **Vitest** em todos os pacotes (com `unplugin-swc` na API e no worker, para os
decorators do NestJS).

- **Unitários**: regras de domínio, máquina de estados do pedido, cálculo de totais.
- **Integração** (Postgres e Redis reais via **Testcontainers**, igual no CI e na máquina
  local): reserva concorrente, webhook idempotente, rollback do webhook em caso de erro,
  outbox/relay, expiração (incluindo sessão já `complete`), pagamento tardio, check-in
  concorrente.
- **Webhook**: gerar payload e assinatura de teste (`stripe.webhooks.generateTestHeaderString`).
  O cliente Stripe fica atrás de uma interface e é substituído por fake nos testes.
- **E2E (opcional)**: Playwright cobrindo a compra completa com cartão de teste `4242 4242 4242 4242`.

## 14. Deploy

- Imagens da API e do worker no GHCR; front na Vercel.
- `prisma migrate deploy` usando `DIRECT_URL` antes de subir a nova versão.
- **Redis para BullMQ**: usar Redis com conexão persistente (Railway, Render Key Value,
  Fly). Evitar Redis serverless cobrado por comando: o BullMQ faz polling constante e
  estoura a cota.
- Postgres gerenciado (Neon, Supabase, Railway). Com pooler (PgBouncer), `DATABASE_URL`
  aponta para o pooler e `DIRECT_URL` para a conexão direta.

## 15. ADRs sugeridos (`docs/adr/`)

1. `0001-monorepo-pnpm-turborepo.md`
2. `0002-stripe-checkout-hospedado.md`: por que não coletar cartão no próprio site
3. `0003-webhook-como-fonte-da-verdade.md`
4. `0004-controle-de-estoque-atomico.md`
5. `0005-fila-bullmq-para-jobs-assincronos.md`
6. `0006-transactional-outbox.md`: por que não enfileirar direto (alternativa avaliada: pg-boss)
7. `0007-sessao-em-cookie-com-bff.md`: cookies first-party via rewrites do Next.js
