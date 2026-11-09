# 0012. Relay da outbox: trava durante a publicação, jobId da linha e falha que não trava o lote

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 5.1 (ROADMAP.md)

## Contexto

Desde a etapa 4.2, o webhook grava os jobs (`send-ticket-email`, `refund-order`) na tabela
`outbox`, na mesma transação da mudança do pedido (ARCHITECTURE.md, seção 7). Faltava quem
levasse essas linhas ao BullMQ. Os requisitos:

- várias instâncias do worker podem rodar ao mesmo tempo, e nenhuma linha pode virar dois jobs
  por causa disso;
- com o Redis fora, nada se perde: a linha espera e sai quando ele volta;
- uma linha nova vira job em cerca de 2 s.

## Decisão

1. **Um lote por transação, com a trava mantida durante a publicação.** O relay trava até 100
   linhas pendentes (`FOR UPDATE SKIP LOCKED`, as mais antigas primeiro), publica cada uma e
   marca `published_at` antes do commit. Outro relay pula as linhas travadas e pega as
   seguintes, então dois workers nunca publicam a mesma linha.
   - O Redis fica dentro da transação. A regra 8 do CLAUDE.md fala de chamadas HTTP externas
     (Stripe, e-mail); o Redis é infraestrutura própria e responde em milissegundos.
   - Descartado: reservar as linhas numa transação, publicar fora e confirmar em outra. Exige
     colunas e prazos de reserva para linhas abandonadas, e a publicação duplicada continua
     possível se a confirmação falhar.
2. **`jobId = outbox.id`.** Se o commit falhar depois de publicar, a linha sai de novo no ciclo
   seguinte, e o BullMQ ignora o `jobId` repetido enquanto o job existir. Por isso os jobs
   concluídos ficam 7 dias no Redis (`removeOnComplete`). Depois disso, quem garante é a
   idempotência de cada job (entrega _at-least-once_).
3. **Publicação que não espera o Redis.** A conexão das filas usa `enableOfflineQueue: false`,
   e cada publicação tem limite de 5 s. Com o Redis fora, a publicação falha na hora em vez de
   segurar a transação com as linhas travadas.
4. **Falha não trava o lote para sempre.** Na primeira publicação que falha, o lote para: as
   linhas anteriores ficam publicadas, e a que falhou ganha `attempts + 1` e espera o próximo
   ciclo (com o Redis fora, as seguintes também falhariam). Tipo de job fora de
   `OUTBOX_JOB_TYPES` vai para o log de erro com `attempts + 1`, e as outras linhas seguem.
5. **Uma fila por tipo de job, com o mesmo nome.** Os consumidores (etapas 5.2 e 5.4) assinam a
   fila do seu tipo; o relay não conhece os consumidores.
6. **Loop de 1 s.** Um lote por segundo, ou na hora quando o lote veio cheio. Erro num ciclo vai
   para o log e o loop segue.
   - Descartado: um job repetível do BullMQ para o relay. O relay existe justamente para quando
     o Redis está fora, e depender dele para rodar seria circular.
7. **Tentativas e falhas dos jobs.** Todo job sai com 5 tentativas e backoff exponencial a
   partir de 2 s. Esgotado, fica em `failed`, a dead-letter do BullMQ. A base dos consumidores
   (`LoggedProcessor`) registra cada falha com `jobId` e `orderId`: `warn` enquanto há
   tentativas, `error` na última.
8. **Shutdown em ordem.** No `SIGTERM`, o relay para de agendar e espera o lote em andamento
   (`beforeApplicationShutdown`). As filas e o Prisma fecham depois, em
   `onApplicationShutdown`; por isso o Prisma deixou de fechar em `onModuleDestroy`.

## Consequências

- Rodar mais de um worker é seguro: o `SKIP LOCKED` divide as linhas entre eles.
- A outbox cresce: linhas publicadas não são apagadas. Uma limpeza periódica das antigas fica
  para a fase 7 (produção).
- O Stripe no worker e o `PrismaUnitOfWork` num pacote compartilhado entram na etapa 5.3, a
  primeira em que o worker roda casos de uso do domínio.
