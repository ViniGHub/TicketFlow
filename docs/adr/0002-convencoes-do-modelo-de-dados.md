# 0002. Convenções do modelo de dados

- **Status:** aceito
- **Data:** 2026-10-16
- **Etapa:** 1.3 (ROADMAP.md)

## Contexto

A etapa 1.3 transforma a seção 3 do ARCHITECTURE.md no schema do Prisma. O documento não
definia o tipo dos IDs e pedia CHECKs e índices parciais em SQL manual. Algumas decisões
afetam etapas seguintes (autenticação, pedidos) e precisam ficar registradas.

## Decisão

1. **IDs em UUID v7** (`@default(uuid(7)) @db.Uuid`). São ordenáveis no tempo, o que mantém
   as inserções no fim do índice B-tree, e não são sequenciais, então não revelam volume nem
   permitem enumerar recursos. Exceção: `stripe_events.event_id` é o id em texto do Stripe.
2. **Índices parciais no `schema.prisma`**, com a preview `partialIndexes` do Prisma 7.10. O
   Prisma introspecta índices: um índice criado à mão na migration não existe no schema, e o
   próximo `migrate dev` geraria um `DROP INDEX`.
3. **CHECKs em SQL manual** na migration. O Prisma não os gera nem os introspecta, então não
   há risco de drift.
4. **`refresh_tokens.family_id`**: todos os tokens de uma cadeia de rotação compartilham o
   mesmo valor. Revogar a família no reuso de um token revogado (seção 10) vira um único
   `UPDATE ... WHERE family_id = ?`, sem percorrer a cadeia de `replaced_by`.
5. **`UNIQUE (order_id, ticket_type_id)`** em `order_items`: segunda linha de defesa para a
   regra de itens sem repetição, validada antes na API.
6. **Chaves estrangeiras em `RESTRICT`**, exceto `refresh_tokens → users` (`CASCADE`). Dados
   de negócio (pedidos, ingressos) nunca somem em cascata.
7. **Seed idempotente** com hash argon2id gerado pelo `node:crypto`, no formato PHC, sem
   dependência nova. A etapa 1.4 escolhe a biblioteca de autenticação livremente, porque o
   formato PHC é o padrão lido por todas.

## Consequências

- A preview `partialIndexes` pode mudar de sintaxe em versões futuras do Prisma. O teste de
  integração "migrations sem drift" (`prisma migrate diff --exit-code`) acusa isso no CI.
- Os nomes das constraints (`ticket_types_available_range_check`, etc.) são fixos e usados
  nos testes e no mapeamento de erros da API.
- O seed roda o JavaScript compilado (`dist/`), porque o client gerado importa com extensão
  `.js`. É preciso compilar o pacote `db` antes de rodar o seed.
