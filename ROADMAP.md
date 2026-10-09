# Roadmap de desenvolvimento do TicketFlow

Este é o plano de construção do sistema, dividido em **fases** (blocos com um objetivo e um
marco verificável) e **etapas** (unidades de entrega). Cada etapa vira **uma branch e um
pull request** e só começa quando as dependências estiverem mergeadas na `main`.

- O **escopo técnico** de cada etapa está aqui. O **como** (modelo de dados, fluxos, regras)
  está no [ARCHITECTURE.md](ARCHITECTURE.md); as regras de código, no [CLAUDE.md](CLAUDE.md).
- Para executar uma etapa com um assistente, use o prompt padrão do [PROMPTS.md](PROMPTS.md).
- Uma etapa só está concluída quando todos os itens de **Pronto quando** foram verificados e
  `pnpm lint && pnpm typecheck && pnpm test` passam (mais `pnpm test:integration` se a etapa
  toca em banco ou Redis).

**MVP = fases 1 a 7.** A fase 8 prepara o projeto para o portfólio e a fase 9 é evolução.

## Visão geral

| Fase | Objetivo | Etapas | Marco |
|---|---|---|---|
| 1. Fundação | Monorepo, CI, banco e autenticação | 1.1 – 1.4 | CI verde e login funcionando pelo Swagger |
| 2. Catálogo | Eventos e lotes | 2.1 | Organizador publica um evento com lotes |
| 3. Núcleo transacional | Pedidos e estoque, ainda sem Stripe | 3.1 – 3.3 | Teste de concorrência 50×10 estável |
| 4. Pagamentos e ingressos | Stripe Checkout, webhook e check-in | 4.1 – 4.4 | Compra com cartão 4242 gera ingressos |
| 5. Processamento assíncrono | Worker, outbox, e-mail, expiração, reembolso | 5.1 – 5.4 | E-mail com QR chega no Mailpit |
| 6. Front-end | Interface do comprador e do organizador | 6.1 – 6.4 | Jornada completa pela interface |
| 7. Produção | Observabilidade, deploy e segurança | 7.1 – 7.3 | Link público funcionando |
| 8. Portfólio | Documentação e material de entrevista | 8.1 – 8.2 | Alguém entende e roda o projeto em 10 min |
| 9. Evolução | Funcionalidades pós-MVP | — | — |

## Dependências

```
Trilha backend:
  1.1 ─▶ 1.2 ─▶ 1.3 ─▶ 1.4 ─▶ 2.1 ─▶ 3.1 ─▶ 3.2 ─▶ 3.3 ─▶ 4.1 ─▶ 4.2
  4.2 ─▶ 4.3, 4.4, 5.1
  5.1 ─▶ 5.2
  4.3 + 5.1 ─▶ 5.3, 5.4

Trilha front-end:
  2.1 ─▶ 6.1
  6.1 + 4.2 ─▶ 6.2
  6.1 + 4.4 ─▶ 6.3
  6.2 + 6.3 ─▶ 6.4

Fechamento:
  fases 5 e 6 ─▶ fase 7 ─▶ fase 8
```

A trilha do front (6.1) pode correr em paralelo com as fases 3 a 5, a partir do momento em
que autenticação (1.4) e catálogo (2.1) estiverem prontos.

---

## Fase 1: Fundação

### 1.1 Bootstrap do monorepo
**Branch:** `chore/bootstrap` · **Depende de:** nada

Escopo:
- pnpm workspaces + Turborepo: `apps/api` (NestJS), `apps/web` (Next.js App Router +
  Tailwind), `apps/worker` (NestJS standalone com `createApplicationContext`),
  `packages/db` (Prisma com model placeholder), `packages/domain`, `packages/contracts`,
  `packages/config`.
- `packages/config`: tsconfig base (`strict: true`), ESLint flat config, Prettier, preset
  do Vitest. Os demais pacotes estendem dele.
- `turbo.json` com `dev`, `build`, `lint`, `typecheck`, `test`, `test:integration`.
- Vitest em todos os pacotes (com `unplugin-swc` na api e no worker).
- `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), `.editorconfig`, `.nvmrc` (Node 24),
  `engines` no `package.json`, `.env.example` (ARCHITECTURE.md, seção 11).
- Validação das variáveis de ambiente com zod no boot da api e do worker.
- Husky + lint-staged + commitlint.
- Um teste trivial por app.

Pronto quando:
- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passam.
- [ ] `pnpm dev` sobe web, api e worker.
- [ ] Commit fora do padrão Conventional Commits é rejeitado pelo hook.

### 1.2 Infra local e CI
**Branch:** `chore/docker-ci` · **Depende de:** 1.1

Escopo:
- `docker-compose.yml`: postgres:17, redis:8 e mailpit (com healthchecks) por padrão;
  api, worker e web no profile `app`.
- Dockerfiles multi-stage (`turbo prune` ou `pnpm deploy`), usuário não-root, healthcheck.
- Helper de Testcontainers compartilhado: sobe Postgres e Redis, aplica migrations, limpa o
  estado entre testes.
- `.github/workflows/ci.yml`: lint + typecheck, testes unitários, testes de integração,
  build das imagens (sem push), Trivy (filesystem e imagens) e gitleaks. Cache do pnpm e do
  Turborepo; `concurrency` cancelando execuções antigas.
- `.github/renovate.json` (ou Dependabot).

Pronto quando:
- [ ] `docker compose up -d` deixa a infra saudável.
- [ ] `docker compose --profile app up --build` sobe tudo.
- [ ] Um teste de integração trivial com Testcontainers passa localmente e no CI.
- [ ] CI verde no PR.

### 1.3 Schema do banco
**Branch:** `feat/db-schema` · **Depende de:** 1.2

Escopo:
- Schema Prisma completo da seção 3: `users`, `refresh_tokens`, `events`, `ticket_types`,
  `orders`, `order_items`, `tickets`, `stripe_events`, `outbox`, com enums.
- SQL manual na migration para os CHECK constraints e os índices parciais.
- `DATABASE_URL` + `DIRECT_URL` no `prisma.config`/datasource.
- Seed: 1 organizador, 1 comprador (e 1 usuário com os dois papéis), 2 eventos com lotes.
- Client exportado por `packages/db` e consumido por api e worker.

Testes obrigatórios (integração):
1. `UPDATE` deixando `available < 0` ou `available > total` é rejeitado pelo banco.
2. `UNIQUE (user_id, idempotency_key)` e `UNIQUE` de `stripe_events.event_id` funcionam.

Pronto quando:
- [ ] `prisma migrate reset` aplica do zero e o seed roda.
- [ ] Os índices parciais existem (conferido em teste ou via `\d` documentado no PR).

### 1.4 Autenticação e sessão
**Branch:** `feat/auth` · **Depende de:** 1.3

Escopo (ARCHITECTURE.md, seção 10):
- `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me`.
- argon2id; access token JWT de 15 min e refresh opaco rotacionado (hash em
  `refresh_tokens`), ambos em cookies httpOnly, `Secure`, `SameSite=Lax`.
- Guard de autenticação e guard de roles (usuário pode ter BUYER e ORGANIZER).
- Checagem de `Origin` nas rotas que alteram estado; `@nestjs/throttler` com storage em
  Redis em `/auth/*`; Helmet; CORS restrito.
- Swagger em `/docs` (com `/docs-json`), `/health/live` e `/health/ready` (`@nestjs/terminus`),
  logs com `nestjs-pino` e `request_id`.
- Filtro global que mapeia erros de domínio para status HTTP.

Testes obrigatórios:
1. Unitários do serviço de auth.
2. Integração: register → login → `/me` → refresh → logout.
3. Reuso de refresh token já rotacionado revoga a família inteira.
4. Excesso de tentativas de login → 429.

Pronto quando:
- [ ] Dá para registrar, logar e chamar `/me` pelo Swagger.
- [ ] `/health/ready` falha quando o Postgres ou o Redis estão fora.

**Marco da fase 1:** CI verde na `main` e autenticação funcionando de ponta a ponta.

---

## Fase 2: Catálogo

### 2.1 Eventos e lotes
**Branch:** `feat/events` · **Depende de:** 1.4

Escopo:
- Públicas: `GET /events` (paginação, filtro por data, só `PUBLISHED`) e `GET /events/:id`
  (com lotes e disponibilidade).
- ORGANIZER (dono): criar, editar, `POST /events/:id/publish`, gerenciar lotes
  (`/events/:id/ticket-types`). Recurso de outro dono → 404.
- Regras: preço em centavos (≥ 0), `total ≥ 1`, não reduzir `total` abaixo do vendido,
  janela de vendas coerente (`sales_start < sales_end ≤ starts_at`), timezone IANA válido,
  `max_per_order ≥ 1`, evento só publica se tiver ao menos um lote.
- O cancelamento de evento fica para a etapa 5.4 (depende de reembolso).

Testes obrigatórios:
1. Unitários das regras de evento e lote.
2. Integração: organizador A não edita evento de B (404); comprador não cria evento (403);
   paginação; reduzir `total` abaixo do vendido → 409.

Pronto quando:
- [ ] Organizador do seed cria, publica e vê seu evento na listagem pública.

**Marco da fase 2:** catálogo navegável pela API.

---

## Fase 3: Núcleo transacional (sem Stripe)

### 3.1 Domínio do pedido
**Branch:** `feat/order-domain` · **Depende de:** 2.1

Escopo (`packages/domain`, sem NestJS nem Prisma):
- `OrderStatus` e a tabela de transições da seção 4 (incluindo `PROCESSING` e
  `REFUND_PENDING`); `InvalidOrderTransitionError`.
- Erros de domínio: `InsufficientStockError`, `SalesWindowClosedError`,
  `MaxPerOrderExceededError`, `EventNotPublishedError`, `IdempotencyConflictError`.
- Cálculo de totais em centavos.
- Interfaces de repositório (`OrderRepository`, `InventoryRepository`, `OutboxRepository`)
  e de gateway de pagamento (`PaymentGateway`), sem implementação.

Testes obrigatórios:
1. Teste parametrizado cobrindo **todos os pares** (estado de origem × estado de destino):
   válidos passam, inválidos lançam erro.

Pronto quando:
- [ ] Cobertura de 100% na máquina de estados.

### 3.2 Reserva de estoque e criação de pedido
**Branch:** `feat/inventory-reservation` · **Depende de:** 3.1

Escopo (ARCHITECTURE.md, seções 5.1, 6 e 7):
- `POST /orders` com `[{ticketTypeId, quantity}]` e header opcional `Idempotency-Key`.
- Validações antes de reservar: evento publicado, janela de vendas, `max_per_order`, sem
  itens repetidos.
- Uma transação: `updateMany` com `available: { gte: qty }` checando `count`, itens em
  ordem de id, criação de `orders` (`PENDING`) e `order_items` com preço copiado do lote.
- Idempotência: mesma chave e mesmo corpo → pedido existente; corpo diferente → 422.

Testes obrigatórios (integração):
1. 50 requisições concorrentes por 10 ingressos → exatamente 10 pedidos, `available = 0`.
2. Pedido com vários itens falha inteiro se um item não tem estoque.
3. `Idempotency-Key` repetida não cria dois pedidos; com corpo diferente → 422.
4. Fora da janela de venda ou acima de `max_per_order` → recusado sem reservar.

Pronto quando:
- [ ] O teste de concorrência passa 10 vezes seguidas, sem flakiness.

### 3.3 Cancelamento e expiração local
**Branch:** `feat/order-expiration` · **Depende de:** 3.2

Escopo:
- `POST /orders/:id/cancel` (dono, só `PENDING`) → `CANCELLED` e devolve estoque.
- `ExpirationService` em `packages/domain`: expira `PENDING` vencidos em lote
  (`FOR UPDATE SKIP LOCKED`), devolvendo estoque na mesma transação da transição.
- Ponto de extensão `SessionExpirer` (implementação nula por enquanto), que a etapa 5.3
  troca pela chamada ao Stripe.

Testes obrigatórios (integração):
1. Expirar duas vezes devolve o estoque uma vez só.
2. Duas execuções **concorrentes** da expiração não devolvem em dobro.
3. Cancelar pedido que não está `PENDING` → 409.

Pronto quando:
- [ ] Estoque volta ao valor original após expirar ou cancelar.

**Marco da fase 3:** núcleo de pedidos à prova de concorrência, sem nenhuma dependência externa.

---

## Fase 4: Pagamentos e ingressos

### 4.1 Integração com Stripe e Checkout Session
**Branch:** `feat/stripe-checkout` · **Depende de:** 3.3

Escopo (ARCHITECTURE.md, seção 5.2):
- Implementação de `PaymentGateway` com o SDK oficial (modo teste) e um fake para testes,
  num módulo reutilizável pelo worker.
- Em `POST /orders`, após o commit da reserva, cria a Checkout Session com
  `idempotencyKey: order.id`, `metadata.order_id`, `client_reference_id`, `expires_at`
  (mínimo de 30 min). Grava `stripe_session_id` e retorna `{ orderId, checkoutUrl }`.
- Compensação se a criação falhar: `CANCELLED` + devolve estoque.
- `GET /orders/:id` (só o dono).
- README: Stripe CLI (`stripe listen`) e cartão 4242.

Testes obrigatórios:
1. Falha do gateway → pedido `CANCELLED` e estoque devolvido.
2. Retentativa usa a mesma `idempotencyKey`.
3. `GET /orders/:id` de outro usuário → 404.

Pronto quando:
- [ ] `POST /orders` devolve uma URL de checkout que abre no Stripe (modo teste).

### 4.2 Webhook transacional (cartão)
**Branch:** `feat/stripe-webhook` · **Depende de:** 4.1

Escopo (ARCHITECTURE.md, seções 5.4 e 7):
- `rawBody` habilitado; assinatura validada (inválida → 400).
- `StripeEventProcessor` reutilizável (o worker vai usá-lo em 5.3): uma transação com
  insert em `stripe_events`, `SELECT ... FOR UPDATE` do pedido, transição, criação de
  tickets e insert na `outbox`. Erro → rollback total e 5xx.
- `checkout.session.completed` (`paid`) → `PAID`, tickets (`qr_token` de 32 bytes
  base64url, `event_id`), linha `send-ticket-email` na outbox.
- `checkout.session.expired` → `EXPIRED` e devolve estoque.
- Outros tipos: grava em `stripe_events` e responde 200.

Testes obrigatórios (integração, assinatura via `generateTestHeaderString`):
1. Assinatura inválida → 400.
2. Mesmo evento 2× → processado 1×.
3. Erro no meio do processamento → nada gravado (nem em `stripe_events`) e reprocessar
   depois funciona.
4. `PAID` cria N tickets e exatamente 1 linha na outbox.

Pronto quando:
- [ ] Compra com 4242 via `stripe listen` deixa o pedido `PAID`.
- [ ] `stripe events resend` não duplica tickets.

### 4.3 Pagamento assíncrono, pagamento tardio e reembolso
**Branch:** `feat/payment-edge-cases` · **Depende de:** 4.2

Escopo (ARCHITECTURE.md, seção 4 e caso de borda da seção 5):
- `completed` com `payment_status = unpaid` → `PROCESSING`;
  `async_payment_succeeded` → `PAID`; `async_payment_failed` → `EXPIRED` + estoque.
- Pagamento tardio em pedido `EXPIRED`: re-reserva (→ `PAID`) ou `REFUND_PENDING` + linha
  `refund-order` na outbox + log `warn`.
- `charge.refunded` → `REFUNDED` e tickets com `voided_at`.

Testes obrigatórios: um teste de integração por linha da tabela de transições da seção 4
que dependa de evento do Stripe.

Pronto quando:
- [ ] Todos os cenários da tabela de transições estão cobertos por teste.

### 4.4 Ingressos, check-in e vendas (API)
**Branch:** `feat/tickets-checkin` · **Depende de:** 4.2

Escopo:
- `GET /me/tickets` (com evento e status do ingresso).
- `POST /events/:id/check-in` (dono do evento) com o `UPDATE` atômico da seção 9; respostas
  distintas para válido, já utilizado, cancelado e de outro evento.
- `GET /events/:id/sales`: vendidos e receita por lote, pedidos por status.

Testes obrigatórios:
1. Dois check-ins simultâneos do mesmo ticket → exatamente um válido.
2. Ticket de outro evento e ticket anulado são recusados.
3. Organizador não vê vendas de evento alheio (404).

Pronto quando:
- [ ] Check-in pelo Swagger com o `qr_token` de um ticket pago funciona uma única vez.

**Marco da fase 4:** compra de ponta a ponta com cartão de teste gera ingressos válidos.

---

## Fase 5: Processamento assíncrono

### 5.1 Worker e relay da outbox
**Branch:** `feat/worker-relay` · **Depende de:** 4.2

Escopo (ARCHITECTURE.md, seções 7 e 8):
- Worker NestJS standalone com `@nestjs/bullmq`, reaproveitando módulos de Prisma e Stripe.
- Relay: lê `outbox` pendente em lotes (`FOR UPDATE SKIP LOCKED`), publica com
  `jobId = outbox.id`, marca `published_at`.
- Backoff exponencial, jobs esgotados em `failed` com log `error`, logs com `jobId`/`orderId`.
- Shutdown gracioso no `SIGTERM`.

Testes obrigatórios:
1. Dois relays concorrentes publicam cada linha uma vez só.
2. Redis zerado antes da publicação → a linha é publicada quando o Redis volta.

Pronto quando:
- [ ] Uma linha nova na outbox vira job em até ~2 s.

### 5.2 E-mail com ingressos
**Branch:** `feat/ticket-email` · **Depende de:** 5.1

Escopo:
- Job `send-ticket-email`: tickets com `emailed_at IS NULL`, QR code PNG por ticket, e-mail
  HTML (datas no timezone do evento).
- Transporte abstraído: SMTP/Mailpit em dev, Resend em produção.
- `emailed_at` gravado logo após o envio.

Testes obrigatórios:
1. Transporte fake recebe um e-mail com N anexos/imagens.
2. Reprocessar o job não reenvia.

Pronto quando:
- [ ] Após uma compra de teste, o e-mail com QR aparece no Mailpit.

### 5.3 Expiração e reconciliação com o Stripe
**Branch:** `feat/stripe-expiration` · **Depende de:** 4.3, 5.1

Escopo (ARCHITECTURE.md, seções 5.6 e 5.7):
- `SessionExpirer` real: `sessions.expire` **antes** de liberar estoque; sessão `complete` →
  `sessions.retrieve` e `StripeEventProcessor`; erro transitório → próxima execução.
- Job repetível `expire-orders` (1/min, `jobId` fixo).
- Job repetível `reconcile-stripe` (a cada 15 min).

Testes obrigatórios:
1. Sessão já `complete` no momento da expiração → estoque **não** é liberado e o pedido
   vira `PAID`.
2. Pedido sem `stripe_session_id` expira normalmente.
3. Reconciliação aplica um pagamento cujo webhook nunca chegou.

Pronto quando:
- [ ] Com `stripe listen` desligado, uma compra paga é confirmada pela reconciliação.

### 5.4 Reembolso e cancelamento de evento
**Branch:** `feat/refunds` · **Depende de:** 4.3, 5.1

Escopo:
- Job `refund-order`: `stripe.refunds.create` com `idempotencyKey = refund:<order.id>`.
- `POST /events/:id/cancel` (dono): evento `CANCELLED`, expira `PENDING`, grava
  `refund-order` para cada `PAID`, tudo numa transação.
- E-mail de cancelamento para os compradores.

Testes obrigatórios:
1. Cancelar evento com 3 pedidos pagos gera 3 jobs de reembolso, cada um executado uma vez.
2. Job de reembolso repetido não gera reembolso duplicado.

Pronto quando:
- [ ] Cancelar um evento no modo teste reembolsa os pedidos e anula os ingressos.

**Marco da fase 5:** o backend está completo; nenhum trabalho depende de o usuário manter a aba aberta.

---

## Fase 6: Front-end

### 6.1 Base do front
**Branch:** `feat/web-foundation` · **Depende de:** 2.1 (pode correr em paralelo com 3 a 5)

Escopo:
- `rewrites` de `/api/*` para `API_URL` (BFF; cookies first-party).
- Script que gera tipos do `/docs-json` com `openapi-typescript`; cliente `openapi-fetch`;
  TanStack Query.
- Login, cadastro, logout; middleware protegendo rotas por role e renovando via
  `/auth/refresh`.
- Layout, componentes base e tokens no Tailwind; estados de loading e erro.

Pronto quando:
- [ ] Login funciona no navegador sem nenhum token em `localStorage`.
- [ ] Alterar a API e regenerar os tipos quebra o typecheck do front quando há incompatibilidade.

### 6.2 Jornada do comprador
**Branch:** `feat/web-checkout` · **Depende de:** 6.1, 4.2

Escopo:
- Lista e detalhe de eventos (datas no timezone do evento), seleção de quantidade por lote.
- Compra: `POST /orders` com `Idempotency-Key` gerada por tentativa → redireciona ao Stripe.
- Página de sucesso com polling (nunca assume pagamento; `PROCESSING` mostra "aguardando
  confirmação"); página de cancelamento.
- "Meus ingressos" com QR code.

Pronto quando:
- [ ] Um comprador escolhe ingressos, paga com 4242 e vê os ingressos na conta.

### 6.3 Área do organizador
**Branch:** `feat/web-organizer` · **Depende de:** 6.1, 4.4 (cancelamento usa 5.4)

Escopo:
- Criar/editar evento e lotes, publicar, cancelar.
- Painel de vendas.
- Check-in: colar o token ou ler o QR pela câmera, com feedback claro para cada resultado.

Pronto quando:
- [ ] Um organizador cria um evento, vê as vendas e faz o check-in de um ingresso pela interface.

### 6.4 Testes E2E
**Branch:** `test/e2e` · **Depende de:** 6.2, 6.3

Escopo:
- Playwright: jornada completa (cadastro → compra com 4242 → ingresso → check-in) contra o
  ambiente do `docker compose --profile app` com `stripe listen`.
- Testes de componentes críticos (seleção de ingressos, página de sucesso).
- Job opcional no CI (manual ou noturno), já que depende do Stripe em modo teste.

Pronto quando:
- [ ] O E2E passa localmente 3 vezes seguidas.

**Marco da fase 6:** demo completa pela interface.

---

## Fase 7: Produção

### 7.1 Observabilidade
**Branch:** `feat/observability` · **Depende de:** fase 5

Escopo:
- OpenTelemetry na api e no worker (HTTP, Prisma, BullMQ), com contexto propagado no
  payload da outbox.
- `/metrics` com pedidos por status, tamanho da outbox pendente e jobs falhos.

Pronto quando:
- [ ] Um pedido pode ser seguido num único trace, do `POST /orders` até o envio do e-mail
  (ex.: Jaeger local no compose).

### 7.2 Deploy e CD
**Branch:** `chore/deploy` · **Depende de:** fases 5 e 6

Escopo (ARCHITECTURE.md, seção 14):
- `deploy.yml` em push na `main` após CI verde: imagens no GHCR (tags `sha` e `latest`),
  `prisma migrate deploy` com `DIRECT_URL`, deploy de api e worker
  (Render, Railway ou Fly.io) e do front na Vercel.
- Redis com conexão persistente; Postgres gerenciado.
- Smoke test em `/health/ready`.
- `docs/deploy.md`: serviços, variáveis, webhook de produção no Stripe (modo teste), rollback.

Pronto quando:
- [ ] Merge na `main` publica a nova versão e a compra de teste funciona no link público.

### 7.3 Revisão de segurança
**Branch:** `chore/security-review` · **Depende de:** 7.2

Escopo:
- Auditoria OWASP Top 10 (prompt "Segurança" do PROMPTS.md).
- `pnpm audit`, Trivy e gitleaks sem achados altos abertos.
- Revisão de autorização por recurso em todas as rotas.

Pronto quando:
- [ ] Achados listados no PR, com os de baixo risco corrigidos e os demais virando issues.

**Marco da fase 7:** sistema no ar, monitorado e revisado.

---

## Fase 8: Portfólio

### 8.1 Documentação e ADRs
**Branch:** `docs/polish` · **Depende de:** fase 7

Escopo: README com link do deploy, badges, GIF do fluxo de compra e "Decisões técnicas";
os ADRs da seção 15 do ARCHITECTURE.md; CONTRIBUTING.md, LICENSE e templates de issue e PR;
revisão de TODOs, dependências sem uso e scripts quebrados.

Pronto quando:
- [ ] Alguém consegue clonar, rodar e entender o projeto em 10 minutos.

### 8.2 Material de entrevista
**Branch:** `docs/interview` · **Depende de:** 8.1

Escopo: `docs/INTERVIEW.md` com 10 perguntas e respostas baseadas no código real
(concorrência, idempotência, outbox, webhooks, filas, CI/CD, segurança).

Pronto quando:
- [ ] Cada resposta aponta para o arquivo ou teste que a comprova.

---

## Fase 9: Evolução (pós-MVP)

Sem ordem fixa; cada item vira uma etapa própria quando for priorizado.

- Pix habilitado como método de pagamento (o fluxo `PROCESSING` já existe desde a 4.3).
- Reembolso pelo painel do organizador (`POST /orders/:id/refund`, reaproveitando `refund-order`).
- Lembrete 24h antes do evento (`send-reminder`).
- Lista de espera para eventos esgotados.
- Cupons de desconto.
- Teste de carga com k6 no fluxo de compra.
