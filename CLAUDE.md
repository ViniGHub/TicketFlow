# TicketFlow: contexto para assistentes de IA

> Este arquivo é lido automaticamente pelo Claude Code. Para outros assistentes,
> copie o conteúdo para `AGENTS.md` ou `.github/copilot-instructions.md` (GitHub Copilot).

## O que é o projeto

TicketFlow é uma plataforma de venda de ingressos para eventos pequenos, com pagamento via
Stripe Checkout (modo teste). Projeto de portfólio: o foco é qualidade de engenharia
(concorrência, idempotência, webhooks, CI/CD), não quantidade de funcionalidades.

**Leia `ARCHITECTURE.md` antes de implementar qualquer coisa.** Ele é a fonte da verdade
para modelo de dados, fluxo de pagamento e regras de negócio.

## Stack

- **Node 24 LTS**. Monorepo com **pnpm workspaces + Turborepo**
- `apps/web`: Next.js (App Router) + TypeScript + Tailwind; BFF via `rewrites` de `/api/*`
- `apps/api`: NestJS + TypeScript
- `apps/worker`: NestJS standalone (`createApplicationContext`) + `@nestjs/bullmq`
- `packages/db`: Prisma (schema, migrations, client compartilhado)
- `packages/domain`: regras de negócio puras (máquina de estados, reserva, expiração)
- `packages/contracts`: schemas zod e tipos compartilhados (DTOs, payloads de jobs)
- `packages/config`: tsconfig, ESLint (flat config), Prettier, preset do Vitest
- PostgreSQL 17, Redis 8, Mailpit (e-mail local), Stripe (modo teste)
- Testes: **Vitest** (com `unplugin-swc` no NestJS) + **Testcontainers** na integração;
  Playwright (e2e, opcional)

## Comandos esperados

```bash
pnpm install
docker compose up -d postgres redis mailpit   # infraestrutura local
pnpm --filter @ticketflow/db prisma migrate dev
pnpm dev                                      # sobe web + api + worker
pnpm lint
pnpm typecheck
pnpm test                                     # unitários
pnpm test:integration                         # sobe postgres e redis via Testcontainers (exige Docker)
pnpm build
```

Se algum comando não existir ainda, crie-o em vez de contornar.

## Regras de código

1. **TypeScript estrito** (`strict: true`). Sem `any` sem justificativa em comentário.
2. **Dinheiro sempre em centavos (inteiros)**, nunca `float`. Moeda: BRL.
3. **Validação de entrada** em toda borda (DTOs com class-validator ou zod).
4. **Nunca confie no front-end** para decidir se um pedido está pago. A fonte da verdade é o
   webhook do Stripe, validado por assinatura.
5. **Operações de estoque e mudança de status do pedido são transacionais.**
6. **Webhooks são idempotentes**: o `event.id` do Stripe é gravado em `stripe_events` com
   constraint UNIQUE **na mesma transação** do processamento; evento repetido é ignorado
   com resposta 200; erro no processamento faz rollback e responde 5xx (o Stripe reenvia).
7. **Nunca enfileirar direto no BullMQ a partir de uma transação de negócio.** Grave na
   tabela `outbox` na mesma transação; o relay do worker publica (`jobId = outbox.id`).
   Todo job é idempotente (entrega *at-least-once*).
8. **Nenhuma chamada HTTP externa (Stripe, e-mail) dentro de transação de banco.** Chamadas
   que criam algo no Stripe usam `idempotencyKey` derivada do pedido.
9. **Regras de negócio ficam em `packages/domain`**, nunca duplicadas entre api e worker.
10. **Nenhum segredo no repositório.** Use `.env` (ignorado pelo git) e mantenha `.env.example`
    sempre atualizado. Variáveis são validadas com zod no boot.
11. Logs estruturados (JSON). Nunca logar dados sensíveis (tokens, assinaturas completas).
12. Tratamento de erro explícito: erros de domínio com classes próprias, mapeados para
    status HTTP corretos.
13. Todo código novo vem com testes. Regras críticas (estoque, webhook, outbox, expiração)
    exigem teste de integração.

## Fluxo de trabalho

- Uma funcionalidade por branch: `feat/<nome>`, `fix/<nome>`, `chore/<nome>`.
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Commits pequenos e focados. PR com descrição clara (o quê, por quê, como testar).
- Antes de dar uma tarefa como concluída: `pnpm lint && pnpm typecheck && pnpm test`.
- Decisões de arquitetura relevantes viram um ADR curto em `docs/adr/`.

## O que NÃO fazer

- Não armazenar nem processar dados de cartão (o Stripe Checkout hospedado cuida disso).
- Não usar `localStorage` para token de autenticação: a sessão é em cookie httpOnly,
  servida no mesmo site via BFF (ARCHITECTURE.md, seção 10).
- Não liberar estoque de pedido expirado antes de expirar a sessão no Stripe.
- Não adicionar dependências pesadas sem necessidade.
- Não reescrever arquivos inteiros quando uma edição pontual resolve.
- Não pular testes para "ganhar tempo".

## Ao trabalhar numa tarefa

1. Releia o trecho relevante do `ARCHITECTURE.md`.
2. Proponha um plano curto antes de editar muitos arquivos.
3. Implemente em passos pequenos, rodando os testes a cada passo.
4. Ao final, resuma o que mudou e liste o que ficou pendente.
