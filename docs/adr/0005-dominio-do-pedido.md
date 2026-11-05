# 0005. Domínio do pedido: transições por tabela e portas com unidade de trabalho

- **Status:** aceito
- **Data:** 2026-11-05
- **Etapa:** 3.1 (ROADMAP.md)

## Contexto

A etapa 3.1 cria o domínio do pedido em `packages/domain`, sem NestJS nem Prisma: estados e
transições, erros da compra, cálculo do total e as interfaces de repositório e de pagamento.
Essas regras vão ser usadas pela criação do pedido (3.2), pelo cancelamento e pela expiração
(3.3 e 5.3), pelo webhook (4.2) e pela reconciliação. Sem um lugar único, cada um repetiria
qual transição vale e quando o estoque volta.

## Decisão

1. **Transições como tabela de pares origem → destino**, cada um com o efeito no estoque:
   `release` (devolve), `reserve` (reserva de novo) ou `none`. `assertTransition` e
   `stockEffectOf` lançam `InvalidOrderTransitionError` para qualquer par fora da tabela,
   inclusive continuar no mesmo estado. Qual transição aplicar é decisão do serviço que
   reage ao gatilho (webhook, cancelamento, expiração).
   - Devolvem estoque: `PENDING → EXPIRED`, `PROCESSING → EXPIRED` e `PENDING → CANCELLED`.
     `EXPIRED → PAID` reserva de novo. Reembolso não devolve: a seção 4 só devolve estoque de
     pedido que não foi pago.
   - Descartado: máquina movida por eventos (`apply(status, 'PAGOU')`). O pagamento tardio de
     um pedido `EXPIRED` tem dois destinos, conforme ainda haja estoque, e a máquina passaria
     a depender do estoque. O teste obrigatório da etapa também é por pares.
2. **Total limitado ao `INTEGER` de `orders.total_cents`** (2.147.483.647 centavos). Os
   limites do catálogo permitem R$ 1 milhão por ingresso e 100 por pedido, ou 10^10 centavos
   num único item: sem o limite, o Postgres recusaria o `INSERT` e a API responderia 500.
   Acima dele, `ORDER_TOTAL_TOO_LARGE` (422).
   - Descartado: trocar a coluna para `BIGINT`. O Stripe também tem um valor máximo por
     pagamento, conferido na etapa 4.1; uma coluna maior só adiaria o erro até lá.
3. **Validações de compra no domínio** (`assertPurchasable`): evento publicado, vendas abertas
   e `max_per_order`, nessa ordem. O início das vendas é inclusivo e o fim, exclusivo. O
   estoque fica de fora, porque quem decide é o decremento atômico da reserva.
4. **Status HTTP**, na convenção do ADR 0004. 409 quando o estado atual impede a operação:
   `INVALID_ORDER_TRANSITION`, `INSUFFICIENT_STOCK`, `EVENT_NOT_PUBLISHED`,
   `SALES_WINDOW_CLOSED`. 422 quando o pedido quebra uma regra: `MAX_PER_ORDER_EXCEEDED`,
   `ORDER_TOTAL_TOO_LARGE`, `IDEMPOTENCY_CONFLICT`.
5. **Portas com unidade de trabalho.** `UnitOfWork.run(work)` entrega os repositórios de
   pedidos, estoque e outbox ligados a uma única transação. Assim o domínio expressa "reserva,
   pedido e outbox gravados juntos" sem conhecer o Prisma.
   - `InventoryRepository.tryReserve` devolve `false` quando falta estoque; o erro é lançado
     pelo domínio.
   - `OutboxRepository` só grava. Ler e marcar como publicado é infraestrutura do relay.
   - `PaymentGateway` é chamado sempre fora de transação, com chave de idempotência derivada
     do pedido.
   - Descartado: passar um `tx` opaco em cada método. Leva a infraestrutura para o domínio e
     é fácil esquecer de repassá-lo. Repositórios sem transação não expressam a atomicidade.
6. **Cobertura exigida no `pnpm test`.** O pacote de domínio roda os testes com cobertura e
   falha se `order-status.ts` ficar abaixo de 100%. Como o CI roda `pnpm test`, uma regressão
   não passa despercebida.

## Consequências

- A etapa 3.2 implementa `UnitOfWork` com `prisma.$transaction` e converte o enum do Prisma
  com um `Record<…, OrderStatus>`: se os dois divergirem, o typecheck quebra.
- As assinaturas das portas podem mudar quando forem implementadas. Este ADR registra o
  desenho (portas e unidade de trabalho), não cada método.
- Ingresso reembolsado não volta à venda.
