# 🎟️ TicketFlow

Plataforma de venda de ingressos para eventos pequenos, com pagamento via **Stripe Checkout**,
reserva de estoque sem overselling, webhooks idempotentes e processamento assíncrono.

> ⚠️ Projeto de portfólio. O Stripe está em **modo teste**: nenhuma cobrança real é feita.
> Use o cartão `4242 4242 4242 4242`, qualquer data futura e qualquer CVC.

[![CI](https://github.com/ViniGHub/TicketFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/ViniGHub/TicketFlow/actions/workflows/ci.yml)

**Demo:** _adicione o link do deploy_ · **API docs:** _link do Swagger_

![Fluxo de compra](docs/images/checkout-flow.gif)

## Por que este projeto

Vender ingresso parece simples até surgirem os problemas reais. Este projeto resolve:

- **Concorrência:** 50 pessoas disputando os últimos 10 ingressos sem vender a mais.
- **Idempotência:** o Stripe reenvia webhooks; ninguém é cobrado ou notificado duas vezes.
- **Consistência:** o pedido é confirmado pelo webhook, mesmo que o usuário feche a aba.
- **Assincronismo:** envio de e-mail com QR code e expiração de reservas em background.

## Funcionalidades

- Cadastro e login (comprador e organizador)
- Organizador cria eventos e lotes de ingressos
- Compra com reserva temporária de estoque e pagamento no Stripe Checkout
- E-mail com ingressos e QR code após a confirmação
- Check-in por QR code (cada ingresso só vale uma vez)
- Painel do organizador com vendas

## Arquitetura

Veja o diagrama completo e o fluxo de pagamento em [ARCHITECTURE.md](ARCHITECTURE.md).

| Camada | Tecnologia |
|---|---|
| Front-end | Next.js, TypeScript, Tailwind |
| API | NestJS, TypeScript, OpenAPI |
| Worker | NestJS standalone + BullMQ + Redis (transactional outbox) |
| Banco | PostgreSQL + Prisma |
| Pagamento | Stripe Checkout (modo teste) |
| E-mail | Mailpit (dev) / Resend (prod) |
| Monorepo | pnpm workspaces + Turborepo |
| Testes | Vitest, Testcontainers, Playwright |
| Infra | Docker, GitHub Actions, GHCR, OpenTelemetry |

## Como rodar localmente

Pré-requisitos: Docker, Node 24 LTS, pnpm e [Stripe CLI](https://stripe.com/docs/stripe-cli).

```bash
git clone https://github.com/ViniGHub/TicketFlow.git
cd TicketFlow
cp .env.example .env          # preencha as chaves de teste do Stripe
docker compose up -d          # postgres, redis, mailpit
pnpm install
pnpm --filter @ticketflow/db prisma migrate dev
pnpm dev                      # web, api e worker
```

Em outro terminal, encaminhe os webhooks do Stripe para a API local:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
# copie o whsec_... exibido para STRIPE_WEBHOOK_SECRET no .env
```

- Front-end: http://localhost:3001
- API + Swagger: http://localhost:3000/docs
- Caixa de e-mail (Mailpit): http://localhost:8025

Para subir **tudo** em containers: `docker compose --profile app up --build`.

## Testes

```bash
pnpm lint
pnpm typecheck
pnpm test                # unitários
pnpm test:integration    # Testcontainers (requer Docker)
```

O teste de concorrência (`inventory.concurrency.spec.ts`) dispara compras simultâneas e
verifica que nunca há overselling.

## Decisões técnicas

- **Webhook como fonte da verdade:** o redirect de sucesso só mostra o status; quem confirma
  o pagamento é o webhook assinado.
- **Estoque atômico:** `UPDATE ... WHERE available >= qty` dentro de transação, com
  `CHECK (available >= 0)` como segunda defesa.
- **Idempotência de webhook:** `event.id` gravado com constraint UNIQUE na mesma transação
  do processamento; se algo falhar, tudo volta e o Stripe reenvia.
- **Transactional outbox:** jobs nascem de uma tabela gravada junto com a mudança de
  negócio, então um pedido pago nunca fica sem e-mail por falha do Redis.
- **Expira no Stripe antes de devolver o estoque:** uma sessão expirada não pode ser paga,
  o que elimina quase todos os casos de pagamento tardio.
- **Stripe Checkout hospedado:** dados de cartão nunca passam pelo meu servidor.
- **Fila para trabalho assíncrono:** respostas rápidas ao Stripe e retentativas com backoff.
- **Sessão em cookie httpOnly via BFF:** o front faz proxy de `/api/*`, então o cookie é
  first-party mesmo com front e API em provedores diferentes.

Detalhes e trade-offs em [`docs/adr/`](docs/adr/).

## Roadmap

O plano de construção, dividido em fases e etapas, está em [ROADMAP.md](ROADMAP.md).
Próximas funcionalidades depois do MVP:

- [ ] Pix via Stripe
- [ ] Reembolso pelo painel do organizador
- [ ] Lista de espera para eventos esgotados
- [ ] Cupons de desconto
- [ ] Testes E2E com Playwright

## Licença

MIT
