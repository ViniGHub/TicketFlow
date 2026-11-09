# 0011. Ingressos, check-in e vendas: UPDATE atômico e o que conta como venda

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 4.4 (ROADMAP.md)

## Contexto

Com os ingressos emitidos no pagamento (ADR 0009), faltavam três coisas:

- o comprador ver os próprios ingressos;
- o organizador validá-los na entrada;
- o organizador acompanhar as vendas do evento.

O check-in é o ponto sensível: duas leituras do mesmo QR code ao mesmo tempo, em portões
diferentes, não podem deixar a mesma pessoa entrar duas vezes. A recusa também precisa dizer o
motivo, porque quem está no portão age de forma diferente diante de ingresso já usado,
cancelado ou de outro evento.

## Decisão

1. **Check-in é um único `UPDATE` condicional**, o da seção 9:
   `checked_in_at IS NULL AND voided_at IS NULL` e o `event_id` do evento. O próprio Postgres
   decide entre leituras simultâneas: a segunda espera a trava de linha da primeira, reavalia o
   `WHERE` e não altera nada. Não há transação explícita nem `SELECT ... FOR UPDATE`.
   - Descartado: ler o ingresso, conferir e depois gravar. Entre a leitura e a escrita, outra
     leitura do mesmo QR passaria na mesma conferência.
2. **O motivo da recusa é lido depois**, só quando o `UPDATE` não altera nenhuma linha. O
   domínio (`checkInRejection`) classifica nesta ordem:

   | Situação                 | Resposta                                 |
   | ------------------------ | ---------------------------------------- |
   | `qr_token` inexistente   | 404 `TICKET_NOT_FOUND`                   |
   | Ingresso de outro evento | 422 `TICKET_FROM_OTHER_EVENT`            |
   | Anulado (reembolso)      | 409 `TICKET_VOIDED`                      |
   | Já utilizado             | 409 `TICKET_ALREADY_USED`, com o horário |

   Outro evento vem primeiro para a resposta não revelar o estado de um ingresso alheio. Anulado
   vem antes de usado porque o reembolso é o fato mais recente. Evento de outro organizador
   responde 404 `EVENT_NOT_FOUND` antes de tocar no ingresso.
   - Descartado: responder sempre 200, com o resultado num campo. Fugiria da convenção da API
     (404 inexistente, 409 conflito com o estado, 422 regra).

3. **Vendas**, com agregação no banco e a regra no domínio (`summarizeSales`):
   - **Vendido e receita:** só pedidos `PAID`, com o preço gravado no pedido, não o preço
     atual do lote. Reembolsado ou em reembolso sai das duas contas.
   - **Reservado:** pedidos `PENDING` e `PROCESSING`. Ele explica a diferença entre
     `total - available` e o vendido.
   - **Pedidos por status:** todos os status, mesmo com zero. Um pedido com vários lotes do
     evento conta uma vez.
   - A soma `quantidade × preço` é feita em `bigint`: 100 ingressos de R$ 999.999,99 passam do
     `int4`.
4. **`GET /me/tickets`** traz os ingressos válidos, usados e anulados, com o `qrToken` (o que o
   comprador apresenta), o lote e o evento. A paginação é por cursor, como em `/me/events`, com
   os mais novos primeiro. O status segue a mesma precedência do check-in: anulado acima de
   usado.
5. **Sem rate limit no check-in.** O `qr_token` tem 256 bits aleatórios e não dá para adivinhar,
   e a rota exige ser o organizador dono do evento.

## Consequências

- O check-in não depende de Redis nem de transação, então continua rápido com vários portões ao
  mesmo tempo.
- As vendas são lidas em três consultas sem um snapshot comum. Durante compras em andamento,
  os números podem divergir por um instante; para um painel do organizador, isso basta.
- O front (fase 6) mostra o QR a partir do `qrToken` de `GET /me/tickets`, e a tela de check-in
  traduz cada código de recusa numa mensagem para o portão.
