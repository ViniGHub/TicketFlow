# 0010. Pagamento assíncrono, pagamento tardio e reembolso pelo webhook

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 4.3 (ROADMAP.md)

## Contexto

O ADR 0009 tratou o caminho feliz do cartão: sessão paga leva o pedido a `PAID`, sessão expirada
leva a `EXPIRED`. Faltava o resto da tabela de transições (ARCHITECTURE.md, seção 4) que depende
do Stripe:

- pagamento assíncrono (Pix, boleto), em que a sessão termina antes do pagamento;
- pagamento que chega com o pedido já `EXPIRED`;
- reembolso.

Até aqui, o pagamento tardio respondia 500 sem registrar o evento, para o Stripe reenviar
enquanto o tratamento não existia. O Stripe também não garante a ordem dos eventos: o resultado
do pagamento assíncrono pode chegar antes do `checkout.session.completed`.

## Decisão

1. **Cada evento confere o status do pedido travado, em vez de supor a ordem de chegada.**

   | Evento                                          | Pedido                    | Efeito                                                  |
   | ----------------------------------------------- | ------------------------- | ------------------------------------------------------- |
   | `completed` com `unpaid`                        | `PENDING`                 | `PROCESSING`, guarda o PaymentIntent, estoque reservado |
   | `async_payment_succeeded` (ou `completed` pago) | `PROCESSING` ou `PENDING` | `PAID`, ingressos e `send-ticket-email`                 |
   | `async_payment_failed`                          | `PROCESSING` ou `PENDING` | `EXPIRED` e o estoque volta                             |
   | pagamento confirmado                            | `EXPIRED`                 | pagamento tardio (decisão 2)                            |
   | `charge.refunded`, valor inteiro                | `REFUND_PENDING`          | `REFUNDED` e os ingressos com `voided_at`               |

   Evento que encontra o pedido já adiante (um `completed` sem pagamento depois da aprovação ou
   da recusa) é registrado sem efeito.

2. **Pagamento tardio reserva de novo ou reembolsa, na mesma transação.** Com estoque, o pedido
   `EXPIRED` vira `PAID` com ingressos. Sem estoque, vira `REFUND_PENDING`, guarda o PaymentIntent
   e `paid_at` e grava `refund-order` na outbox (o job chama `stripe.refunds.create` com
   `refund:<order.id>`). Os dois casos saem em log `warn`.
   - A re-reserva passou a ser tudo ou nada (`transitionOrder`): se um lote falta, os já
     reservados voltam antes do erro. Sem isso, como o webhook captura o erro e segue na mesma
     transação para o reembolso, o rollback não desfaria a reserva parcial e o estoque vazaria.
   - Pedido grátis sem estoque não tem o que reembolsar: responde 500 sem registrar, como os
     outros pagamentos sem caminho possível.
3. **`charge.refunded` acha o pedido pelo PaymentIntent.** O evento traz a charge, não a sessão
   nem o `order_id`. `orders.stripe_payment_intent_id` ganhou índice UNIQUE: a busca não varre a
   tabela, e um pagamento nunca pertence a dois pedidos.
   - Descartado: pôr o `order_id` no metadata do PaymentIntent (`payment_intent_data`). Mudaria
     os parâmetros da sessão (ADR 0008), e o metadata não chega à charge de forma garantida.
4. **Reembolso feito pelo painel do Stripe num pedido `PAID`** passa por `REFUND_PENDING` e
   `REFUNDED` na mesma transação e anula os ingressos, com log `warn`.
   - Descartado: ignorar. O comprador teria o dinheiro de volta e os ingressos continuariam
     valendo no check-in.
5. **Reembolso parcial é registrado sem efeito**, com log `warn`: o TicketFlow só reembolsa o
   pedido inteiro, e um parcial feito no painel precisa de decisão humana.
6. **Continuam respondendo 500 sem registrar**: pagamento de pedido `CANCELLED` e de sessão
   diferente da gravada no pedido. Nenhum dos dois tem caminho possível: o cancelamento expira a
   sessão antes, e a sessão avulsa é expirada antes de a URL sair (ADR 0008). Substitui a
   decisão 8 do ADR 0009, que valia também para o pedido `EXPIRED`.
7. **Só cartão no MVP**, como no ADR 0008. O caminho de `PROCESSING` está pronto e testado com
   eventos assinados, mas a sessão não oferece Pix nem boleto.

## Consequências

- Toda linha da tabela da seção 4 que depende de evento do Stripe tem teste de integração.
- O worker (etapa 5.x) consome `refund-order`. Até lá, o pedido sem estoque fica em
  `REFUND_PENDING` com a linha na outbox, sem reembolso de fato.
- O job de expiração (5.3), ao receber `complete` de `sessions.expire`, aplica o mesmo
  processador ao estado da sessão, e o pagamento cai no caminho normal ou no tardio.
