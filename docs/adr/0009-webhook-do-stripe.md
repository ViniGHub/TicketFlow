# 0009. Webhook do Stripe: fonte da verdade do pagamento, numa transação idempotente

- **Status:** aceito
- **Data:** 2026-11-06
- **Etapa:** 4.2 (ROADMAP.md)

## Contexto

O comprador paga na página hospedada do Stripe (ADR 0008), e o TicketFlow precisa saber que o
pagamento aconteceu. O front não serve para isso: o comprador pode fechar a aba depois de pagar,
e qualquer um pode chamar uma rota do front (CLAUDE.md, regra 4). Quem sabe é o Stripe, que
avisa por webhook. O Stripe entrega cada evento _at-least-once_: pode mandar o mesmo evento mais
de uma vez, inclusive ao mesmo tempo, e reenvia enquanto a resposta não for 2xx. O pagamento
precisa virar `PAID`, ingressos e e-mail exatamente uma vez, e uma falha no meio não pode deixar
o evento marcado como processado sem ter sido.

## Decisão

1. **O webhook é a única fonte da verdade do pagamento.** `POST /webhooks/stripe` confere a
   assinatura (`Stripe-Signature`, HMAC do corpo cru com o `STRIPE_WEBHOOK_SECRET`, tolerância
   de 5 minutos contra replay) antes de ler qualquer campo. Assinatura ausente ou inválida
   responde 400 e não grava nada. A API guarda o corpo cru (`rawBody` do Nest), porque
   reserializar o JSON muda os bytes e invalida a assinatura. A rota não tem login, rate limit
   nem Swagger: quem autentica é a assinatura.
2. **Uma transação por evento, no domínio.** O `StripeEventProcessor` (packages/domain), que o
   worker vai reaproveitar na etapa 5.3, faz numa só transação:
   1. registra o evento em `stripe_events`;
   2. trava o pedido (`FOR UPDATE`);
   3. faz a transição;
   4. no pagamento, emite um ingresso por unidade (`qr_token` de 32 bytes aleatórios em
      base64url) e grava `send-ticket-email` na outbox.

   Qualquer erro desfaz tudo, inclusive o registro do evento.

3. **`INSERT ... ON CONFLICT DO NOTHING` em `stripe_events`**, com a contagem de linhas dizendo
   se o evento é repetido. Duas entregas simultâneas do mesmo evento se resolvem no próprio
   índice da PK: a segunda espera a primeira terminar. Se a primeira confirmar, a segunda não
   grava nada e responde 200; se a primeira desfizer, a segunda processa.
   - Descartado: deixar a PK falhar e capturar o erro (P2002). No Postgres, um erro aborta a
     transação inteira, e a captura dependeria de o INSERT ser sempre o primeiro comando.
4. **Toda falha no processamento responde 500**, inclusive erro de domínio, que o filtro global
   mapearia para 409 ou 422. A falha não está no que o Stripe mandou, e só um 5xx deixa claro
   que ele deve reenviar. O erro vai para o log com o id e o tipo do evento.
5. **O que não é do TicketFlow é registrado e responde 200**, com log `warn`:
   - sessão sem `order_id` de pedido (outra integração na mesma conta);
   - pedido inexistente (outro ambiente usando a mesma conta de teste).

   Tipos que o TicketFlow não trata também são registrados, sem log de alerta. Reenviar não
   mudaria nada, e um 5xx faria o Stripe insistir por dias.

6. **A sessão do evento precisa ser a gravada no pedido.** Sem isso, o aviso de expiração de uma
   sessão avulsa (a que o `startCheckout` expira quando o pedido saiu de `PENDING`, ADR 0008)
   poderia expirar um pedido cuja sessão de verdade continua aberta.
7. **Cada evento, conforme o estado do pedido:**

   | Evento                                       | Pedido                                    | Efeito                                          |
   | -------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
   | `completed`, `paid` ou `no_payment_required` | `PENDING`                                 | `PAID`, ingressos e 1 linha `send-ticket-email` |
   | `completed`                                  | já `PAID`                                 | nada                                            |
   | `completed`, `unpaid` (Pix)                  | qualquer                                  | registrado e ignorado até a etapa 4.3           |
   | `completed`, `paid`                          | `EXPIRED` ou `CANCELLED`, ou outra sessão | erro, 500, nada registrado                      |
   | `expired`                                    | `PENDING`                                 | `EXPIRED` e o estoque volta                     |
   | `expired`                                    | `CANCELLED` ou `EXPIRED`                  | nada                                            |
   - Pedido grátis (`no_payment_required`) não tem PaymentIntent; `paid_at` é a data do evento,
     a mesma em toda reentrega.
   - O cancelamento e a expiração expiram a sessão antes de mudar o pedido (ADR 0007), então o
     aviso do Stripe costuma chegar com o pedido já fechado. Quem trava o pedido primeiro
     devolve o estoque; o outro encontra o pedido fora de `PENDING` e não devolve de novo.

8. **Pagamento tardio responde 500 até a etapa 4.3.** Um pagamento confirmado para pedido que não
   espera mais por ele (`EXPIRED`, ou de outra sessão) não é registrado: o Stripe reenvia, e a
   4.3 troca o erro pelo tratamento (re-reservar ou reembolsar).
   - Descartado: registrar e ignorar. O comprador teria pago e o evento se perderia, sem
     ingresso e sem reembolso.
9. **O payload do job leva só o id do pedido** (`packages/contracts`, `jobs.ts`). O job lê os
   ingressos do banco, então nenhum dado pessoal fica parado na outbox. O domínio passa a
   depender de `@ticketflow/contracts` para o nome e o formato do job.

## Consequências

- Os testes de integração assinam os eventos com `generateTestHeaderString`, pelo
  `@ticketflow/payments/testing`, e nenhum teste fala com o Stripe.
- Se o cancelamento perde a corrida para o aviso de expiração, o comprador recebe 409
  `ORDER_NOT_CANCELLABLE` com o pedido `EXPIRED`. O estoque volta uma vez só, que é o que
  importa.
- A etapa 4.3 trata `async_payment_succeeded`, `async_payment_failed`, `charge.refunded` e o
  pagamento tardio, que hoje são registrados sem efeito ou respondem 500.
- O job de reconciliação (etapa 5.3) chama o mesmo `StripeEventProcessor` para recuperar
  webhooks perdidos.
