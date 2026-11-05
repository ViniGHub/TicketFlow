# 0007. Expiração e cancelamento: sessão expira fora da transação, depois trava e reconfere

- **Status:** aceito
- **Data:** 2026-11-05
- **Etapa:** 3.3 (ROADMAP.md)

## Contexto

Pedidos `PENDING` não pagos expiram (job a cada minuto, etapa 5.3) e o comprador pode
cancelá-los. Nos dois casos o estoque volta, e só pode voltar **uma vez**, mesmo com duas
execuções da expiração ao mesmo tempo ou um cancelamento correndo junto. Além disso, a
sessão do Stripe precisa expirar antes de o estoque voltar, para não poder mais ser paga
(CLAUDE.md, "O que NÃO fazer").

A seção 5 do ARCHITECTURE.md dava a entender que a chamada ao Stripe acontece com o pedido
travado (`FOR UPDATE SKIP LOCKED` e, "para cada um, primeiro" a chamada). Isso seguraria trava
e conexão durante uma chamada HTTP, o que a regra 8 do CLAUDE.md proíbe.

## Decisão

1. **A expiração acontece em três passos curtos** (`ExpirationService.expireDue`):
   1. Uma transação curta pega um lote de candidatos (`lockExpiredPending`, `FOR UPDATE SKIP
LOCKED`). `SKIP LOCKED` pula os pedidos que outra execução ou um cancelamento está
      processando; as travas acabam com a transação.
   2. Para cada candidato, **sem transação aberta**, expira a sessão no Stripe, se houver.
   3. Uma transação por pedido trava (`lockById`), **reconfere** que ele continua `PENDING` e
      só então devolve o estoque e marca `EXPIRED`.

   A reconferência do passo 3 é o que garante devolver uma vez só: se duas execuções pegarem
   o mesmo pedido, a segunda o encontra `EXPIRED` e não faz nada.
   - Sessão já paga (`complete`): o estoque fica; o pedido entra no resumo como pagamento
     concluído. A etapa 5.3 aplica ali o mesmo tratamento do webhook.
   - Erro do Stripe ou ao gravar: o pedido entra no resumo como falha e fica para a próxima
     execução; o lote continua.
   - `PROCESSING` nunca é expirado pelo job (seção 4).

2. **O cancelamento segue a mesma ordem** (`cancelOrder`): lê o pedido e confere dono e status,
   expira a sessão fora de transação e depois trava, reconfere e devolve. Se a sessão já foi
   paga, recusa com `ORDER_PAYMENT_COMPLETED` (409).
3. **`transitionOrder`** aplica o efeito de estoque da tabela da seção 4 e grava o status na
   mesma transação. Cancelamento, expiração e, na etapa 4.2, o webhook usam a mesma função.
4. **Erros próprios do cancelamento**: `ORDER_NOT_FOUND` (404, também para pedido de outro
   comprador) e `ORDER_NOT_CANCELLABLE` (409) em vez do `INVALID_ORDER_TRANSITION`, para a
   mensagem ao comprador ser clara.

Descartado:

- Manter a trava durante a chamada ao Stripe: viola a regra 8, e uma resposta lenta do Stripe
  seguraria conexões do pool e travas de pedidos.
- Uma coluna para marcar o pedido como "em processamento" pelo worker: exige migration e não
  é necessária, porque a reconferência já resolve a concorrência.

## Consequências

- Duas execuções simultâneas podem expirar a mesma sessão no Stripe duas vezes. Expirar uma
  sessão já expirada é inofensivo (`already-expired`).
- Até a etapa 4.1 não existem sessões: a API injeta uma implementação nula do
  `SessionExpirer`, que a 4.1 troca pelo gateway do Stripe.
- O job `expire-orders` (5.3) só precisa chamar `expireDue` e registrar o resumo no log.
