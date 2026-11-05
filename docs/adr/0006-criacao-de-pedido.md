# 0006. Criação de pedido: trava compartilhada do evento e idempotência sob concorrência

- **Status:** aceito
- **Data:** 2026-11-05
- **Etapa:** 3.2 (ROADMAP.md)

## Contexto

A etapa 3.2 cria o `POST /orders`: valida os itens, reserva o estoque com decremento atômico
e grava o pedido `PENDING`, tudo numa transação, com `Idempotency-Key` opcional. As portas e
os erros vieram da etapa 3.1 (ADR 0005). Faltava decidir três coisas: onde mora a
orquestração, como a compra convive com as escritas do organizador e o que acontece quando
duas requisições com a mesma chave correm juntas.

## Decisão

1. **A criação é um caso de uso do domínio** (`placeOrder`), escrito sobre as portas. A API
   valida a forma da entrada, calcula o hash do corpo, chama o caso de uso e converte a
   resposta. O caso de uso fica testável com um banco em memória, e o teste de integração
   cobre a concorrência no Postgres.
   - Descartado: um service na API com o Prisma direto, como no catálogo. As portas ficariam
     sem uso e a ordem da reserva e a decisão de idempotência só seriam testáveis com banco.
2. **A compra trava os eventos em modo compartilhado.** Antes de ler os lotes,
   `SELECT ... FROM events ... FOR SHARE`, em ordem de id. Compras do mesmo evento não se
   bloqueiam, mas esperam as escritas do organizador (`FOR UPDATE`, ADR 0004) e são esperadas
   por elas. Sem a trava, uma compra que leu o evento publicado logo antes de um cancelamento
   (etapa 5.4) gravaria o pedido depois, e o comprador poderia pagar por um evento cancelado;
   o mesmo vale para uma mudança na janela de vendas do lote.
   - Isto ajusta o ADR 0004, que dizia que "a reserva trava só o lote". A ordem das travas
     continua evento, depois lote, então não há ciclo nem deadlock.
   - Descartado: `FOR UPDATE` no evento, que enfileiraria todas as compras do evento.
3. **Reserva em ordem de id do lote**, com `UPDATE ... WHERE available >= qty`. Todos os
   itens são validados antes da primeira reserva. Faltou estoque num lote, a transação volta
   inteira.
4. **Idempotência.** O `requestHash` é o SHA-256 dos itens normalizados (ordenados por lote,
   ids em minúsculas). Mesma chave e mesmo hash devolvem o pedido existente com 201 e o header
   `Idempotent-Replayed: true`; hash diferente responde 422.
   - **Mesma chave em requisições simultâneas.** A segunda pode passar pela busca da chave
     antes de a primeira gravar. Ela então falha: no `UNIQUE (user_id, idempotency_key)`
     (traduzido de `P2002` para `IdempotencyKeyTakenError`) ou antes, por exemplo sem
     estoque, porque a primeira levou o último ingresso. Em qualquer erro de domínio com
     chave, `placeOrder` consulta a chave de novo, depois do rollback: se o pedido existe,
     devolve como replay; se não, o erro original segue. Erro de infraestrutura não consulta.
5. **Rate limit por usuário**: 20 pedidos por minuto, contados pelo id do usuário. Por IP,
   compradores no mesmo Wi-Fi (o do local do evento, por exemplo) dividiriam o limite.
6. **Limites da transação explícitos** no `PrismaUnitOfWork`: 5 s para conseguir conexão e
   10 s de duração. Os padrões do Prisma (2 s e 5 s), com o pool de 10 conexões do `pg`,
   estouravam com dezenas de compras disputando o mesmo lote, e o estouro viraria 500.

## Consequências

- O cancelamento de evento (5.4) e a edição de lotes esperam as compras em andamento, e
  vice-versa. Com o volume de eventos pequenos, a espera é de milissegundos.
- A resposta do `POST /orders` é o pedido; a etapa 4.1 acrescenta o `checkoutUrl`.
- Os repositórios Prisma ficam na API. Quando o worker precisar deles (5.3), vão para um
  pacote compartilhado.
