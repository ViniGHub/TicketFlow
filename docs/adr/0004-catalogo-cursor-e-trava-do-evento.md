# 0004. Catálogo: paginação por cursor e trava do evento nas escritas

- **Status:** aceito
- **Data:** 2026-11-05
- **Etapa:** 2.1 (ROADMAP.md)

## Contexto

A etapa 2.1 expõe o catálogo de eventos e lotes. O ROADMAP pede paginação, janela de vendas
coerente (`sales_start < sales_end ≤ starts_at`) e que o total de um lote não fique abaixo do
vendido, sem definir como. Duas dessas regras dependem de dados que outra requisição pode
estar mudando ao mesmo tempo: a data do evento e a janela de cada lote, e o `available` que a
reserva de estoque (etapa 3.2) decrementa.

## Decisão

1. **Paginação por cursor (keyset).** `GET /events` ordena por `(starts_at, id)` e continua
   depois da chave do último item da página. `GET /me/events` ordena por `id` decrescente:
   com UUID v7, é a ordem de criação. O cursor é a chave em JSON e base64url, validado com
   zod; um cursor adulterado responde 400. Cada página busca `limit + 1` linhas para saber se
   existe a próxima, sem `COUNT(*)`.
   - Descartado: offset (`page`/`pageSize`). Pula ou repete itens quando um evento é
     publicado durante a navegação, fica mais lento à medida que o offset cresce e exige
     `COUNT(*)` para o total.
2. **Toda escrita no catálogo começa travando o evento**:
   `SELECT ... FROM events WHERE id = ? AND organizer_id = ? FOR UPDATE`. A mesma consulta
   confere o dono (nenhuma linha → 404) e serializa as escritas de um mesmo evento. Sem ela,
   mover a data do evento e estender o fim das vendas de um lote ao mesmo tempo passariam nas
   duas validações e deixariam o lote vendendo depois do início do evento.
   - Alterar o total também trava o lote, para ler `available` sem corrida com a reserva de
     estoque: o decremento atômico de um pedido espera a trava. A regra
     (`resizeStock`) fica em `packages/domain`.
   - Ordem das travas: evento, depois lote. A reserva trava só o lote, então não há ciclo
     nem deadlock.
   - Descartado: `UPDATE ... WHERE total - available <= :novo`. É atômico, mas a regra ficaria
     em SQL na API, fora de `packages/domain`, e as referências de campo do Prisma não
     expressam `total - available`.
3. **Status HTTP do catálogo.** 400 para a forma da entrada (zod, campo a campo); 422 para
   entrada bem formada que quebra uma regra dependente de outros dados (`INVALID_SALES_WINDOW`,
   `EVENT_IN_PAST`); 409 para conflito com o estado do recurso
   (`TICKET_TYPE_TOTAL_BELOW_SOLD`, `EVENT_WITHOUT_TICKET_TYPES`, `EVENT_NOT_EDITABLE`,
   `EVENT_NOT_DELETABLE`); 404 também para recurso de outro organizador.
4. **Datas e fusos.** Datas de entrada exigem fuso explícito (`Z` ou offset); sem ele, a hora
   seria ambígua. O fuso do evento só aceita nomes IANA, normalizados pelo `Intl`; offsets
   fixos como `-03:00` são recusados, porque não acompanham mudanças de regra do fuso.
5. **Publicação idempotente** e **exclusão só de rascunho**: um evento publicado pode ter
   pedidos e ingressos; o caminho para ele é o cancelamento (etapa 5.4).

## Consequências

- O front (etapa 6.2) pagina com "carregar mais": não existe número de páginas nem total.
- Sem `from`, `GET /events` lista só eventos futuros; eventos passados aparecem com `from`
  explícito.
- Escritas concorrentes num mesmo evento esperam umas às outras. Com o volume de um catálogo
  de eventos pequenos, a trava não é gargalo.
- A etapa 3.2 precisa manter a ordem das travas: nunca travar o evento depois de um lote.
