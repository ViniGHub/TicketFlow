# Prompts para construir o TicketFlow

Sequência de prompts para colar no seu assistente no VS Code (Claude Code, Copilot Chat,
Cursor etc.). Cada etapa deve virar **uma branch e um pull request**.

## Como usar

1. Coloque `CLAUDE.md`, `ARCHITECTURE.md` e `README.md` na raiz do repositório antes de começar.
   Se usar Copilot, copie o `CLAUDE.md` para `.github/copilot-instructions.md`.
2. Rode um prompt por vez, **na ordem**. Não pule etapas.
3. Em cada etapa: peça um plano primeiro (modo Plan, se existir), revise e só então deixe
   implementar.
4. Ao final de cada etapa, confira os critérios de aceite, rode `lint`, `typecheck` e `test`,
   faça commit (Conventional Commits) e abra o PR.
5. Leia o código gerado. Em entrevista você precisa saber explicar cada decisão.

> Dica: se o assistente se perder, comece uma conversa nova e diga:
> "Leia CLAUDE.md e ARCHITECTURE.md e continue a partir da etapa X."

---

## Etapa 0: Bootstrap do monorepo

**Branch:** `chore/bootstrap`

```
Leia CLAUDE.md e ARCHITECTURE.md.

Crie o esqueleto do monorepo TicketFlow com pnpm workspaces + Turborepo (seção 2):
- apps/api (NestJS), apps/web (Next.js App Router + Tailwind),
  apps/worker (NestJS standalone com createApplicationContext, sem servidor HTTP),
  packages/db (Prisma, ainda sem models além de um placeholder),
  packages/domain, packages/contracts (zod) e packages/config (vazios, com um export de exemplo).
- packages/config com tsconfig base (strict: true), ESLint flat config, Prettier e preset do
  Vitest; os demais pacotes estendem dele.
- turbo.json com as tasks dev, build, lint, typecheck, test e test:integration
  (dependências entre pacotes via ^build). Scripts na raiz chamando o turbo.
- Vitest em todos os pacotes; na api e no worker, com unplugin-swc para os decorators do Nest.
- .gitignore, .editorconfig, .nvmrc (Node 24), campo engines no package.json raiz,
  .env.example conforme a seção 11 do ARCHITECTURE.md.
- Validação das variáveis de ambiente com zod no boot da api e do worker.
- Husky + lint-staged + commitlint (Conventional Commits).
- Um teste trivial em cada app para provar que o runner de testes funciona.

Não implemente regras de negócio ainda. Antes de criar arquivos, me mostre o plano com a
árvore de diretórios final.
```

**Critérios de aceite:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passam;
`pnpm dev` sobe os três apps.

---

## Etapa 1: Docker Compose e CI

**Branch:** `chore/docker-ci`

```
Leia CLAUDE.md e ARCHITECTURE.md.

1. Crie docker-compose.yml na raiz com: postgres:17 (volume, healthcheck), redis:8
   (healthcheck), mailpit (SMTP 1025, UI 8025). Esses três sobem por padrão.
   Adicione api, worker e web sob o profile "app", cada um com seu Dockerfile
   multi-stage (imagem final enxuta com `pnpm deploy`/`turbo prune`, usuário não-root,
   healthcheck).
2. Configure Testcontainers (Postgres e Redis) para os testes de integração, com um helper
   compartilhado que sobe os containers, aplica as migrations e limpa o estado entre testes.
3. Crie .github/workflows/ci.yml disparando em pull_request e push na main, com jobs:
   - lint + typecheck
   - testes unitários
   - testes de integração (Testcontainers usa o Docker do runner)
   - build das imagens Docker (sem push)
   - scan com Trivy (filesystem e imagens) e gitleaks
   Use cache do pnpm e do Turborepo e concurrency para cancelar execuções antigas.
4. Adicione .github/renovate.json (ou Dependabot) agrupando atualizações menores.
5. Atualize o README com a seção "Como rodar" se algo mudou.

Explique cada decisão relevante em comentários curtos nos arquivos.
```

**Critérios de aceite:** `docker compose up -d` sobe a infra saudável; `docker compose --profile app up --build` sobe tudo; CI verde no PR.

---

## Etapa 2: Banco de dados e autenticação

**Branch:** `feat/auth-and-schema`

```
Leia CLAUDE.md e ARCHITECTURE.md (seções 3, 4, 9 e 10).

1. Em packages/db, escreva o schema Prisma completo conforme a seção 3: users, refresh_tokens,
   events, ticket_types, orders, order_items, tickets, stripe_events, outbox. Inclua enums,
   índices (inclusive os parciais) e SQL manual na migration para os CHECK constraints
   e índices parciais que o Prisma não gera. Configure DIRECT_URL para migrations.
   Adicione um seed com 1 organizador, 1 comprador e 2 eventos com lotes.
2. Em apps/api, implemente autenticação conforme a seção 10: POST /auth/register,
   /auth/login, /auth/refresh, /auth/logout e GET /me. Hash argon2id, access token JWT de
   15 min e refresh token opaco rotacionado (hash em refresh_tokens, reuso revoga a família),
   ambos em cookies httpOnly, Secure, SameSite=Lax. Guard de autenticação e guard de roles
   (um usuário pode ter BUYER e ORGANIZER). Validação de DTOs, checagem de Origin nas rotas
   que alteram estado, rate limiting com @nestjs/throttler e storage em Redis, Helmet e CORS.
3. Configure Swagger em /docs e /health/live e /health/ready com @nestjs/terminus
   (checando banco e Redis). Logs com nestjs-pino.
4. Testes: unitários do serviço de auth e integração de register/login com banco real.

Antes de implementar, mostre o plano.
```

**Critérios de aceite:** migrations aplicam do zero; seed roda; Swagger abre; testes de auth passam.

---

## Etapa 3: Eventos e lotes de ingressos

**Branch:** `feat/events`

```
Leia CLAUDE.md e ARCHITECTURE.md (seções 3 e 9).

Implemente em apps/api o CRUD de eventos e ticket_types:
- Rotas públicas: GET /events (paginação, filtro por data, apenas PUBLISHED) e GET /events/:id
  (com lotes e disponibilidade).
- Rotas de ORGANIZER: criar, editar, publicar evento e gerenciar lotes. O organizador só
  pode alterar os próprios eventos (autorização por recurso; recurso de outro dono → 404).
  O cancelamento de evento com reembolso fica para a etapa 6 (depende de outbox e Stripe).
- Regras: preço em centavos, total >= 1, não reduzir "total" abaixo do que já foi vendido,
  datas de venda coerentes, timezone IANA válido, max_per_order >= 1.
- DTOs validados, erros de domínio mapeados para status HTTP corretos, Swagger atualizado.
- Testes unitários das regras e testes de integração das rotas, incluindo casos de
  autorização negada.
```

**Critérios de aceite:** organizador A não consegue editar evento do organizador B (403/404 testado); paginação funciona.

---

## Etapa 4: Reserva de estoque anti-overselling

**Branch:** `feat/inventory-reservation`

```
Leia CLAUDE.md e ARCHITECTURE.md (seções 4, 5 e 6).

Implemente a criação de pedidos com reserva de estoque, ainda SEM Stripe:
- POST /orders com itens [{ticketTypeId, quantity}] e header opcional Idempotency-Key.
- Validações antes de reservar: evento PUBLISHED, dentro da janela sales_start/sales_end,
  quantity <= max_per_order, sem itens repetidos.
- Em UMA transação: decremento atômico de estoque com
  ticketType.updateMany({ where: { id, available: { gte: qty } }, data: { available: { decrement: qty } } }),
  verificando count; itens processados em ordem determinística de id;
  criação de orders (PENDING, expires_at = now + RESERVATION_TTL_MINUTES) e order_items
  com unit_price_cents copiado do lote.
- Estoque insuficiente → erro de domínio (409) e nada é gravado.
- Idempotency-Key: UNIQUE (user_id, idempotency_key) + request_hash. Mesma chave e mesmo
  corpo → pedido existente; mesma chave e corpo diferente → 422.
- Máquina de estados do pedido em packages/domain, com a tabela de transições da seção 4
  (incluindo PROCESSING e REFUND_PENDING) e transições inválidas lançando erro.
- POST /orders/:id/cancel (dono, apenas PENDING) → CANCELLED e devolve estoque.
- Serviço de expiração em packages/domain: expira pedidos PENDING vencidos em lote
  (FOR UPDATE SKIP LOCKED) e devolve o estoque, idempotente. Por enquanto sem Stripe; deixe
  um ponto de extensão para "expirar a sessão antes de liberar" (etapa 6).

TESTES OBRIGATÓRIOS (integração, Postgres real):
1. 50 requisições concorrentes disputando 10 ingressos → exatamente 10 pedidos criados,
   available = 0, nenhum negativo.
2. Pedido com múltiplos itens falha por completo se um item não tem estoque.
3. Expirar pedido devolve estoque exatamente uma vez, mesmo rodando duas vezes.
4. Idempotency-Key duplicada não cria dois pedidos; corpo diferente → 422.
5. Pedido fora da janela de venda ou acima de max_per_order é recusado sem reservar.

Mostre o plano antes de codar.
```

**Critérios de aceite:** teste de concorrência passa de forma estável (rode 10 vezes); sem flakiness.

---

## Etapa 5: Stripe Checkout e webhook

**Branch:** `feat/stripe-payments`

```
Leia CLAUDE.md e ARCHITECTURE.md (seções 4, 5 e 7), com atenção ao trecho sobre TTL da
reserva, outbox e pagamento tardio.

1. Integre o Stripe (SDK oficial, modo teste) em um módulo/provider isolado atrás de uma
   interface, para poder usar um fake nos testes. Reutilizável pelo worker.
2. Em POST /orders, após o commit da reserva (fora da transação), crie a Checkout Session
   (mode payment, line_items do pedido em BRL, metadata.order_id, client_reference_id,
   expires_at alinhado ao pedido respeitando o mínimo de 30 minutos do Stripe, success_url
   e cancel_url) com idempotencyKey = order.id. Salve stripe_session_id e retorne
   { orderId, checkoutUrl }. Se a criação da sessão falhar, compense: cancele o pedido e
   devolva o estoque.
3. Crie POST /webhooks/stripe:
   - Habilite rawBody no NestFactory e valide a assinatura com STRIPE_WEBHOOK_SECRET
     (inválida → 400).
   - UMA transação contendo: insert em stripe_events (UNIQUE violada → rollback e 200),
     SELECT ... FOR UPDATE do pedido, transição de estado, criação de tickets e insert na
     outbox. Qualquer erro → rollback total e resposta 5xx (o Stripe reenvia).
   - checkout.session.completed com payment_status paid: pedido → PAID, cria tickets com
     qr_token aleatório (32 bytes, base64url) e event_id, grava outbox send-ticket-email.
   - checkout.session.completed com payment_status unpaid (Pix): pedido → PROCESSING.
   - checkout.session.async_payment_succeeded → PAID (mesmo efeito acima);
     checkout.session.async_payment_failed → EXPIRED e devolve estoque.
   - checkout.session.expired: pedido PENDING → EXPIRED e devolve estoque.
   - charge.refunded: REFUND_PENDING → REFUNDED e tickets com voided_at.
   - Pagamento tardio (pedido já EXPIRED): tentar reservar de novo; sem estoque →
     REFUND_PENDING + outbox refund-order + log warn explícito.
   - Extraia o handler para um serviço reutilizável: o worker vai chamá-lo a partir do
     job de expiração e da reconciliação.
4. GET /orders/:id (apenas dono) para a página de sucesso consultar o status.
5. Testes de integração com payloads e assinaturas geradas via
   stripe.webhooks.generateTestHeaderString: assinatura inválida → 400; evento repetido
   2x → processado 1x; erro no meio do processamento → rollback, stripe_events vazio e
   reprocessamento posterior funciona; fluxo completo PENDING→PAID com linha na outbox;
   fluxo Pix PENDING→PROCESSING→PAID; expiração; pagamento tardio com e sem estoque.
6. Documente no README como usar o Stripe CLI (stripe listen) e o cartão 4242.

Mostre o plano antes de implementar.
```

**Critérios de aceite:** compra de ponta a ponta funciona com `stripe listen`; reenviar o mesmo evento (`stripe events resend`) não duplica tickets.

---

## Etapa 6: Worker (e-mail com QR e expiração)

**Branch:** `feat/worker-jobs`

```
Leia CLAUDE.md e ARCHITECTURE.md (seções 5, 7 e 8).

Em apps/worker (NestJS standalone + @nestjs/bullmq + Redis):
1. Relay da outbox: loop que lê linhas com published_at IS NULL (FOR UPDATE SKIP LOCKED,
   em lotes), publica no BullMQ com jobId = outbox.id e marca published_at. Seguro com
   várias instâncias do worker.
2. Job send-ticket-email: busca os tickets do pedido com emailed_at IS NULL, gera um QR code
   PNG por ticket (conteúdo = qr_token), monta o e-mail em HTML e envia por SMTP (Mailpit
   em dev; abstraia o transporte para trocar por Resend em produção). Marque
   tickets.emailed_at logo após o envio (retentativa não reenvia).
3. Job refund-order: chama stripe.refunds.create com idempotencyKey = refund:<order.id>.
4. Job repetível expire-orders (a cada minuto, jobId fixo): para cada pedido vencido,
   PRIMEIRO chama stripe.checkout.sessions.expire; só se der certo (ou sessão já expirada,
   ou pedido sem sessão) marca EXPIRED e devolve o estoque. Se a sessão estiver complete,
   não libera estoque: busca a sessão e aplica o handler do webhook da etapa 5.
5. Job repetível reconcile-stripe (a cada 15 min): pedidos PENDING/PROCESSING com sessão
   criada há mais de 10 min → retrieve da sessão e aplica o mesmo handler.
6. Cancelamento de evento (POST /events/:id/cancel na api): evento → CANCELLED, expira os
   PENDING e grava refund-order na outbox para cada PAID, na mesma transação.
7. Retentativas com backoff exponencial; jobs esgotados ficam em failed com log error;
   logs estruturados com jobId e orderId.
8. Nada de regra duplicada: use packages/domain e os mesmos módulos Prisma/Stripe da api.
9. Shutdown gracioso (SIGTERM com worker.close()).
10. Testes (Testcontainers): relay publica cada linha uma vez mesmo com dois relays
    concorrentes; job de e-mail com transporte fake e idempotência; expiração em lote;
    expiração com sessão já complete não libera estoque; reconciliação aplica pagamento
    perdido.

No fim, confirme que o e-mail aparece no Mailpit após uma compra de teste.
```

**Critérios de aceite:** após pagar, o e-mail com QR chega no Mailpit; reprocessar o job não envia duplicado.

---

## Etapa 7: Front-end

**Branch:** `feat/web`

```
Leia CLAUDE.md e ARCHITECTURE.md (seção 9).

Em apps/web (Next.js App Router, TypeScript, Tailwind), implemente:
- BFF: rewrites de /api/* para API_URL no next.config, para que o navegador só fale com
  o domínio do front e os cookies httpOnly da API sejam first-party (seção 10).
- Páginas: lista de eventos, detalhe do evento com seleção de quantidade por lote (datas
  no timezone do evento), login/cadastro, "Meus ingressos" (com QR code), página de sucesso
  do pedido (polling em GET /orders/:id até sair de PENDING/PROCESSING ou timeout, nunca
  assumir pagamento; PROCESSING mostra "aguardando confirmação do Pix"), página de
  cancelamento.
- Fluxo de compra: escolher ingressos → POST /orders (com Idempotency-Key gerada no
  cliente por tentativa de compra) → redirecionar para checkoutUrl.
- Área do organizador: criar/editar evento e lotes, publicar/cancelar, ver vendas, tela de
  check-in (digitar/colar token ou ler QR pela câmera) mostrando "válido", "já utilizado",
  "cancelado" ou "de outro evento".
- Autenticação pelos cookies da API (sem NextAuth, sem token em localStorage); middleware
  do Next protegendo rotas por role, com renovação via /auth/refresh.
- Cliente de API tipado gerado do OpenAPI (/docs-json) com openapi-typescript +
  openapi-fetch; TanStack Query para cache e polling; estados de loading/erro,
  responsivo, acessível (labels, foco, contraste).
- Testes de componentes críticos e, se possível, um teste E2E com Playwright da jornada
  de compra usando o cartão 4242 4242 4242 4242.

Faça um visual limpo e consistente, sem exagero. Mostre o plano antes.
```

**Critérios de aceite:** dá para criar evento, comprar, ver o ingresso e fazer check-in pela interface.

---

## Etapa 8: Deploy e CD

**Branch:** `chore/deploy`

```
Leia CLAUDE.md e ARCHITECTURE.md.

Crie .github/workflows/deploy.yml disparando em push na main (após CI verde):
1. Build e push das imagens da api e do worker para o GitHub Container Registry (ghcr.io)
   com tags sha e latest.
2. Rodar prisma migrate deploy (com DIRECT_URL) contra o banco de produção antes de subir
   a nova versão.
3. Deploy da API e do worker no provedor escolhido [ESCOLHA: Render | Railway | Fly.io],
   e do front na Vercel (API_URL apontando para a API). Redis com conexão persistente
   (não usar Redis serverless cobrado por comando com BullMQ; ver seção 14).
4. Smoke test pós-deploy chamando /health/ready.
Use environments do GitHub com secrets (nunca valores no repo). Documente em
docs/deploy.md: serviços, variáveis necessárias, como configurar o webhook de produção
no dashboard do Stripe (modo teste) e como fazer rollback.

Não invente valores de secrets; liste o que preciso configurar manualmente.
```

**Critérios de aceite:** merge na `main` publica a nova versão; o link do README funciona.

---

## Etapa 9: Polimento para o portfólio

**Branch:** `docs/polish`

```
Leia todos os arquivos .md do projeto.

1. Reescreva o README com: link do deploy, badges (CI, cobertura), GIF do fluxo de compra
   (me diga o que gravar e onde salvar), diagrama de arquitetura, seção "Por que este
   projeto", como rodar com um comando, e "Decisões técnicas".
2. Crie os ADRs listados na seção 15 do ARCHITECTURE.md em docs/adr/, curtos (contexto,
   decisão, consequências).
3. Adicione CONTRIBUTING.md curto, LICENSE (MIT) e templates de issue e pull request.
4. Revise o repositório: segredos commitados, TODOs esquecidos, dependências sem uso,
   scripts quebrados. Liste o que encontrar e corrija o que for seguro.
5. Gere um arquivo docs/INTERVIEW.md com 10 perguntas que um entrevistador faria sobre este
   projeto (concorrência, idempotência, webhooks, filas, CI/CD, segurança) e respostas
   objetivas baseadas no código real.
```

**Critérios de aceite:** alguém consegue clonar, rodar e entender o projeto em 10 minutos.

---

## Prompts avulsos úteis

**Revisão de código antes do PR**
```
Faça uma revisão crítica do diff desta branch como um engenheiro sênior. Procure bugs,
race conditions, falhas de autorização, falta de validação, N+1 queries, testes ausentes e
violações do CLAUDE.md. Liste por severidade, com arquivo e linha.
```

**Quando um teste está instável**
```
O teste X falha de forma intermitente. Não aumente timeouts nem adicione retries como
solução. Investigue a causa raiz (ordem de execução, estado compartilhado, race
condition) e proponha a correção.
```

**Para estudar o que foi gerado**
```
Explique o código desta pasta como se eu fosse apresentá-lo numa entrevista: qual problema
resolve, por que foi feito assim, quais alternativas existiam e quais são os trade-offs.
```

**Segurança**
```
Audite o projeto contra o OWASP Top 10: autenticação, autorização por recurso, injeção,
exposição de dados, configuração de CORS/Helmet, validação do webhook e tratamento de
segredos. Liste achados e corrija os de baixo risco.
```

**Extras (depois do MVP)**
```
Implemente reembolso pelo painel do organizador: POST /orders/:id/refund levando o pedido
PAID → REFUND_PENDING e gravando refund-order na outbox (o job já existe), devolvendo o
estoque (opcional por evento). O webhook charge.refunded já finaliza REFUNDED e invalida os
tickets. Com testes.
```
