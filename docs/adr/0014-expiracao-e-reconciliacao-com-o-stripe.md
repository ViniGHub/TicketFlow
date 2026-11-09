# 0014. Expiração e reconciliação com o Stripe: o processador do webhook com um evento sintético

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 5.3 (ROADMAP.md)

## Contexto

A expiração local (ADR 0007) expira a sessão no Stripe antes de devolver o estoque. Quando o
Stripe responde que a sessão já está `complete`, o pagamento venceu a corrida, e a
`ExpirationService` só informava o pedido em `paymentCompleted`, sem aplicar o pagamento. O
webhook também pode não chegar: deploy no meio da entrega, endpoint fora do ar, segredo
trocado. A seção 5 do ARCHITECTURE.md pede dois jobs recorrentes no worker:

- `expire-orders`, a cada minuto (passo 6);
- `reconcile-stripe`, a cada 15 min (passo 7).

## Decisão

1. **Reconciliar é passar o estado atual da sessão pelo `StripeEventProcessor`**, o mesmo do
   webhook (ADR 0009), como um evento sintético:
   - `complete` vira `checkout.session.completed`, e `expired` vira
     `checkout.session.expired`;
   - sessão `open` não vira evento: o comprador ainda pode pagar.

   O id do evento é estável por estado: `reconcile:<sessão>:<status>:<payment_status>`.
   Reconciliar o mesmo estado de novo é uma entrega repetida, que `stripe_events` descarta. Um
   estado novo (o Pix aprovado depois) é outro evento.
   - Descartado: transições próprias da reconciliação. Duplicariam as regras do webhook
     (CLAUDE.md, regra 9).
   - Descartado: buscar os eventos reais (`events.list`). O Stripe só os guarda por 30 dias,
     a busca exige paginação por tipo, e o que importa é o estado atual da sessão.

2. **Webhook e reconciliação podem se cruzar.** O evento real e o sintético têm ids diferentes,
   então os dois ficam em `stripe_events`. Quem travar o pedido primeiro aplica a mudança, e o
   outro cai em `already-paid` ou `already-closed`, sem efeito.
3. **Sessão paga na expiração.** A `ExpirationService` não mudou. O job `expire-orders` chama
   `StripeReconciler.reconcileOrder` para cada pedido em `paymentCompleted`, logo em seguida e
   fora de transação: o pedido vira `PAID`, e o estoque nunca volta.
4. **Quais pedidos a reconciliação consulta.** `PENDING` ou `PROCESSING` com sessão, criados
   há mais de 10 min, os mais antigos primeiro, em lotes de 100 (nova porta
   `orders.findAwaitingPayment`).
   - A leitura não trava: a consulta ao Stripe acontece fora de transação (regra 8), e o
     processador trava cada pedido ao aplicar.
   - O corte de 10 min deixa o webhook, que costuma chegar em segundos, resolver primeiro.
   - Sem índice novo: a consulta percorre `orders` a cada 15 min, o que cabe na escala do
     projeto. Se crescer, um índice parcial em `created_at` com
     `status IN ('PENDING', 'PROCESSING')` resolve.
5. **Job schedulers do BullMQ (`upsertJobScheduler`) com id fixo, igual ao nome do job.** O
   ROADMAP fala em `jobId` fixo, a forma dos repeatable jobs antigos; o scheduler é o que os
   substitui no BullMQ 6.
   - Reiniciar o worker, ou duas réplicas subindo juntas, não duplica o agendamento. Mudar o
     intervalo no código atualiza o que está no Redis.
   - O registro acontece na subida sem segurá-la. Com o Redis fora, o worker sobe mesmo assim
     e tenta registrar de novo a cada 10 s.
6. **Uma tentativa por execução**, sem backoff: a próxima execução já vem no intervalo.
   - Ficam no Redis os últimos 100 jobs concluídos e os últimos 1.000 falhos. Um job por
     minuto com os 7 dias dos jobs da outbox (ADR 0012) seriam 10 mil jobs parados.
   - A conclusão vai para o log em `debug`. Vão em `log` o pedido expirado e o pagamento
     aplicado na expiração; vão em `warn` o pedido mudado pela reconciliação (o webhook não
     chegou) e o pedido que falhou.
7. **Execuções simultâneas são seguras.** O BullMQ agenda a próxima execução quando a atual
   começa. Se uma execução passar do intervalo, outra réplica pode pegar a seguinte:
   - a expiração usa `SKIP LOCKED` e reconfere o pedido travado (ADR 0007);
   - a reconciliação é deduplicada pelo id do evento sintético.
8. **O worker usa o mesmo gateway e os mesmos repositórios da API.** O gateway vem do pacote
   `payments` (ADR 0008). Os repositórios Prisma das portas do domínio saíram da API para
   `packages/persistence`, compartilhado pelos dois.

## Consequências

- Com o `stripe listen` desligado, uma compra paga é confirmada em até uns 25 min: os 10 min de
  corte mais até 15 min do ciclo. O webhook que chega depois é registrado sem efeito.
- O `paid_at` de um pedido reconciliado é a hora da reconciliação. A sessão não informa a hora
  do pagamento, e buscá-la no PaymentIntent seria mais uma chamada ao Stripe.
- A sessão não distingue um Pix pendente de um recusado: os dois ficam `complete` e `unpaid`.
  Um pedido `PROCESSING` cujo `async_payment_failed` se perdeu continua `PROCESSING`, com o
  estoque reservado. Consultar o PaymentIntent resolveria. Hoje o checkout aceita só cartão, e
  o Pix está na lista de depois do MVP.
- O BullMQ dispara a primeira execução de um scheduler `every` assim que ele é registrado, então
  cada subida do worker roda os dois jobs na hora. Os dois são idempotentes.
