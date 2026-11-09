import { Logger } from '@nestjs/common';
import { isOutboxJobType } from '@ticketflow/contracts';

import { type JobPublisher } from '../queues/job-publisher';

import { type OutboxStore, type PendingOutboxRow } from './outbox-store';

// Relay da transactional outbox (ARCHITECTURE.md, seção 7; ADR 0012).

export const RELAY_BATCH_SIZE = 100;

export interface RelayBatchResult {
  published: number;
  failed: number;
  /** O lote veio cheio: provavelmente há mais linhas esperando. */
  full: boolean;
}

/**
 * Publica um lote de linhas pendentes da outbox, numa transação: trava as linhas, publica
 * cada uma com `jobId = outbox.id` e marca `published_at`. A trava fica até o commit, então
 * dois relays nunca publicam a mesma linha.
 *
 * Se uma publicação falha (Redis fora), o lote para ali: as anteriores ficam publicadas e a
 * que falhou ganha uma tentativa e espera o próximo ciclo. Se o commit falhar depois de
 * publicar, a linha é publicada de novo, e o BullMQ ignora o `jobId` repetido.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: JobPublisher,
    private readonly batchSize = RELAY_BATCH_SIZE,
    private readonly now: () => Date = () => new Date(),
    private readonly logger = new Logger(OutboxRelay.name),
  ) {}

  relayBatch(): Promise<RelayBatchResult> {
    return this.store.inTransaction(async (batch) => {
      const rows = await batch.lockPending(this.batchSize);
      const published: string[] = [];
      let failed = 0;

      for (const row of rows) {
        if (!isOutboxJobType(row.type)) {
          // Não trava o resto: as outras linhas seguem, esta espera alguém olhar.
          this.logger.error({ message: 'Tipo de job desconhecido na outbox', ...fieldsOf(row) });
          await batch.recordFailure(row.id);
          failed += 1;
          continue;
        }
        try {
          await this.publisher.publish({ type: row.type, jobId: row.id, payload: row.payload });
        } catch (error) {
          this.logger.warn({
            message: 'Falha ao publicar o job; a linha fica para o próximo ciclo',
            ...fieldsOf(row),
            attempts: row.attempts + 1,
            error: error instanceof Error ? error.message : String(error),
          });
          await batch.recordFailure(row.id);
          failed += 1;
          break;
        }
        published.push(row.id);
        this.logger.log({ message: 'Job publicado', ...fieldsOf(row) });
      }

      if (published.length > 0) {
        await batch.markPublished(published, this.now());
      }
      return { published: published.length, failed, full: rows.length === this.batchSize };
    });
  }
}

/** Campos de log de uma linha: o `jobId` e, quando o payload tem, o `orderId`. */
function fieldsOf(row: PendingOutboxRow): Record<string, string> {
  const fields: Record<string, string> = { jobId: row.id, jobType: row.type };
  const { payload } = row;
  if (payload && typeof payload === 'object' && 'orderId' in payload) {
    const { orderId } = payload;
    if (typeof orderId === 'string') {
      fields['orderId'] = orderId;
    }
  }
  return fields;
}
