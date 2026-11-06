# 0008. Checkout Session: criação depois do commit, compensação e parâmetros deterministas

- **Status:** aceito
- **Data:** 2026-11-06
- **Etapa:** 4.1 (ROADMAP.md)

## Contexto

O `POST /orders` reserva o estoque e grava o pedido `PENDING` numa transação (ADR 0006). Falta
a sessão de pagamento no Stripe Checkout. É uma chamada HTTP externa: não pode acontecer dentro
da transação (CLAUDE.md, regra 8), pode falhar e pode ser repetida, pelo cliente com a mesma
`Idempotency-Key` ou pelo próprio SDK. Era preciso decidir onde fica o adaptador, o que fazer
quando a criação falha, como uma retentativa não cria uma segunda sessão e como respeitar os
limites do Stripe (validade da sessão e valor do pagamento).

## Decisão

1. **Adaptador num pacote próprio, `packages/payments`**, sem NestJS, como os outros pacotes:
   `StripePaymentGateway` (SDK `stripe` 23.1.0) implementa o `PaymentGateway` do domínio, e cada
   app monta o seu provider (`PAYMENT_GATEWAY` na API; o worker, na etapa 5.3). O
   `FakePaymentGateway`, em memória e com a idempotência do Stripe, fica num ponto de entrada
   separado (`@ticketflow/payments/testing`), que o código de produção não importa. Os testes
   de integração montam a API com ele, então nenhum teste chama o Stripe.
   - Descartado: o adaptador dentro de `apps/api`. O worker precisaria de uma cópia para expirar
     sessões e reembolsar.
2. **Caso de uso `startCheckout` no domínio**, chamado depois do commit do `placeOrder`, sempre
   fora de transação:
   - pedido que não está `PENDING`: nada a pagar, `checkoutUrl` nulo;
   - `PENDING` com sessão: busca a URL da sessão existente (`retrieve`), sem criar outra;
   - `PENDING` sem sessão: cria a sessão e depois trava o pedido, **reconfere** que continua
     `PENDING` sem outra sessão e só então grava o `stripe_session_id`. Se o pedido saiu de
     `PENDING` no meio da chamada (cancelado, expirado), a sessão nova é expirada e não fica
     gravada: a URL dela nunca foi entregue, e ninguém paga por um pedido cancelado.
   - Descartado: gravar a sessão sem travar o pedido. Uma retentativa simultânea que caísse na
     compensação deixaria uma sessão pagável num pedido `CANCELLED`.
3. **Compensação** quando a criação falha: trava o pedido e, só se ele continua `PENDING` sem
   sessão, passa para `CANCELLED` devolvendo o estoque (`transitionOrder`). Se outra requisição
   com a mesma chave já gravou a sessão, o pedido fica como está. A resposta é 503
   `CHECKOUT_UNAVAILABLE`, o mesmo status da API com o Redis fora; é o único erro de domínio que
   responde 5xx, e o filtro registra a causa no log de erro.
   - Descartado: 502. Também descreve a falha de um serviço externo, mas fugiria da convenção
     que a API já tem para dependência fora do ar.
4. **Parâmetros deterministas, com `idempotencyKey: order.id`.** O Stripe recusa a mesma chave
   com parâmetros diferentes, então tudo vem do pedido gravado: itens de `order_items` (preço
   copiado do lote, nome "Evento – Lote"), `metadata.order_id`, `client_reference_id`, URLs de
   volta a partir do `APP_URL` (`/orders/<id>?checkout=success|cancel`) e o `expires_at`.
   - O `expires_at` é o fim da reserva ajustado ao intervalo que o Stripe aceita (30 min a 24 h
     depois da criação), com 5 min de folga para a latência e a diferença de relógio:
     `[created_at + 35 min, created_at + 24 h − 5 min]`. Com o TTL padrão de 30 min, a sessão
     vale 35; o job de expiração (5.3) a encerra quando o pedido vence.
   - Descartado: calcular a partir de `now`. A retentativa mandaria outro valor e o Stripe
     recusaria a chave.
   - Limitações: a retentativa de um pedido sem sessão mais de 5 min depois da criação manda um
     `expires_at` que o Stripe já não aceita, e o pedido é compensado. O mesmo acontece se o
     organizador renomear o lote entre a tentativa e a retentativa. Nos dois casos o comprador
     começa outra compra.
5. **Replay e consulta.** O replay de pedido que não está `PENDING` responde 201 com o pedido
   como está e `checkoutUrl: null`, como o replay já fazia desde a etapa 3.2. O
   `GET /orders/:id` lê só o banco, sem `checkoutUrl`, e fica fora do rate limit, porque a
   página de sucesso faz polling.
   - Descartado: gravar a URL numa coluna nova. Exige migration, e a URL só vale enquanto a
     sessão está aberta: o `retrieve` sabe disso, a coluna não.
6. **Limites de valor** (documentação do Stripe, "Minimum and maximum charge amounts"):
   - Máximo de **R$ 999.999,99** por pedido (`99.999.999`, 8 dígitos), o valor que qualquer
     forma de pagamento aceita; cartão aceita mais, Pix e boleto não. Substitui o limite do
     `INTEGER` do ADR 0005. O preço máximo do lote acompanha o mesmo valor.
   - Mínimo de **R$ 0,50** para pedido pago: total entre 1 e 49 centavos responde 422
     `ORDER_TOTAL_TOO_SMALL` antes de reservar. Uma conta que recebe em outra moeda tem o
     mínimo convertido; se ficar acima, o Stripe recusa e o pedido é compensado.
   - Total **zero** é aceito: desde a API `2023-08-16`, o Checkout conclui pedidos grátis em
     `mode: payment` sem coletar forma de pagamento e sem PaymentIntent.
7. **Só cartão no MVP** (`payment_method_types: ['card']`). Pix e boleto concluem a sessão antes
   do pagamento (`PROCESSING`), fluxo da etapa 4.3 e do pós-MVP. Pedido grátis não leva o campo.
8. **SDK**: versão da API fixada pelo pacote (`2026-10-28.endive`), timeout de 10 s (o padrão de
   80 s seguraria a requisição do comprador) e 2 retentativas de rede, seguras porque toda
   criação leva a chave do pedido.

## Consequências

- O worker (etapa 5.3) usa o mesmo `createStripePaymentGateway` para expirar sessões e
  reembolsar.
- A etapa 4.2 trata `payment_status = no_payment_required` (pedido grátis) como pago, sem
  PaymentIntent para gravar.
- A etapa 6.2 cria a página `/orders/:id` do front, que recebe `?checkout=success|cancel`.
- Até a etapa 5.3 não há job de expiração: com uma chave real, o pedido continua `PENDING`
  depois de a sessão vencer no Stripe, até o webhook da 4.2 tratar `checkout.session.expired`.
