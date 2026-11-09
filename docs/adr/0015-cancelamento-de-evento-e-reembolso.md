# 0015. Cancelamento de evento e reembolso: uma transação sem Stripe, e o pagamento que chega depois vira reembolso

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 5.4 (ROADMAP.md)

## Contexto

O organizador precisa cancelar um evento publicado. Isso afeta três tipos de pedido:

- os pagos precisam ser reembolsados;
- as reservas pendentes precisam acabar;
- os compradores precisam ser avisados.

O ROADMAP pede tudo numa transação. Só que encerrar uma reserva exige antes expirar a sessão no
Stripe (ADR 0007), e nenhuma chamada externa pode acontecer dentro de transação (CLAUDE.md,
regra 8). O pagamento também pode chegar depois do cancelamento: numa sessão que ainda não
expirou, por um Pix aprovado mais tarde ou como pagamento tardio.

## Decisão

1. **O cancelamento é um caso de uso do domínio (`cancelEvent`), numa transação sem Stripe:**
   1. Trava o evento do organizador (`FOR UPDATE`, a mesma trava das escritas do catálogo). As
      compras em andamento (`FOR SHARE`) terminam antes, e as novas esperam e encontram o
      evento cancelado.
   2. Trava, em ordem de id, os pedidos `PENDING`, `PROCESSING` e `PAID` do evento.
   3. Aplica a regra de cada status:

      | Status     | O que acontece                                                                                                                                                       |
      | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
      | PAID       | `REFUND_PENDING`, com os ingressos anulados na hora (o check-in já recusa) e `refund-order` mais o e-mail de aviso na outbox. Pedido grátis vai direto a `REFUNDED`. |
      | PENDING    | A reserva acaba agora (`expires_at = now`). O job `expire-orders` (ADR 0014) expira a sessão no Stripe e só depois devolve o estoque, em até 1 minuto.               |
      | PROCESSING | Fica como está: o Stripe ainda vai aprovar ou recusar o pagamento.                                                                                                   |

   4. Marca o evento como `CANCELLED`, com `cancelled_at`.

   Cancelar de novo devolve o evento sem mudar nada. Um rascunho responde 409
   `EVENT_NOT_CANCELLABLE`: rascunho se exclui.

   - Descartado: expirar as sessões dentro da requisição, pedido por pedido. Seria lento, e uma
     falha no meio deixaria o cancelamento pela metade.
   - Descartado: um job próprio para expirar os pedidos do evento. O `expire-orders` já faz
     isso, com a ordem certa e a corrida com o pagamento tratada.

2. **Pagamento de evento cancelado vira reembolso.** O processador do webhook lê o status dos
   eventos do pedido depois de travá-lo.
   - Se algum foi cancelado, o pagamento fica registrado (`paid_at`, PaymentIntent) e é
     devolvido, sem emitir ingressos:
     - `PENDING` e `PROCESSING` passam por `PAID` até `REFUND_PENDING` na mesma transação;
     - `EXPIRED` vai direto a `REFUND_PENDING`, sem reservar o estoque de novo.
   - A tabela de transições não muda.
   - A leitura do evento é sem trava, e não há deadlock: o cancelamento trava o evento e
     depois os pedidos, e o pagamento trava só o pedido. Se o cancelamento chega depois,
     encontra o pedido já pago e o reembolsa. Se chegou antes, o pagamento enxerga o evento
     cancelado.
3. **O job `refund-order` é idempotente em três níveis:**
   1. Pedido que não está em `REFUND_PENDING` (já `REFUNDED`, por exemplo) nem chama o Stripe.
   2. A chave `refund:<pedido>` faz o Stripe devolver o mesmo reembolso por 24 h.
   3. Depois disso, o Stripe recusa um segundo reembolso com `charge_already_refunded`, e o
      adaptador trata isso como sucesso.

   O pedido só vira `REFUNDED` com o `charge.refunded`, a fonte da verdade (ADR 0010). Falha
   do Stripe sobe, e o BullMQ tenta de novo com backoff.

4. **O pedido é reembolsado inteiro**, mesmo com ingressos de outro evento: a compra aceita
   lotes de eventos diferentes, e o domínio só reembolsa o pedido inteiro. Os ingressos do
   outro evento também são anulados.
5. **Um e-mail de aviso por pedido pago** (`send-event-cancelled-email`). Ele diz quais
   eventos foram cancelados, que os ingressos não valem mais e quanto volta. Pedidos
   pendentes não recebem: nunca foram pagos.
   - Não há marca de envio no banco. O job só se repete se o processo cair entre o envio e a
     conclusão; no Resend, o `Idempotency-Key` descarta a repetição.
   - O transporte de e-mail virou um módulo próprio do worker, compartilhado com o e-mail de
     ingressos.

## Consequências

- Depois do cancelamento, o estoque das reservas pendentes leva até 1 minuto para voltar. Isso
  não muda nada para o comprador, porque o evento já não vende.
- Um evento cancelado pode ganhar reembolsos depois do cancelamento: os Pix aprovados mais
  tarde e as sessões pagas na janela antes da expiração. Esses compradores também recebem o
  e-mail de aviso.
- Um comprador com ingressos de dois eventos perde os dois quando um deles é cancelado.
  Reembolso parcial, ou um evento por pedido, fica para depois do MVP.
- O check-in recusa os ingressos do evento cancelado logo no cancelamento, sem esperar o
  `charge.refunded`.
