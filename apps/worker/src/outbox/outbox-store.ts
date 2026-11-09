import { type Prisma, type PrismaClient } from '@ticketflow/db';

// Leitura e marcação da outbox pelo relay (ARCHITECTURE.md, seção 7). É infraestrutura do
// relay e não passa pelo domínio, que só grava as linhas (OutboxRepository).

export interface PendingOutboxRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** O que o relay faz com a outbox dentro de uma transação. */
export interface OutboxBatch {
  /**
   * Trava até `limit` linhas não publicadas, as mais antigas primeiro, pulando as que outro
   * relay já travou (`FOR UPDATE SKIP LOCKED`).
   */
  lockPending(limit: number): Promise<PendingOutboxRow[]>;
  markPublished(ids: readonly string[], publishedAt: Date): Promise<void>;
  /** Soma uma tentativa à linha que não pôde ser publicada; ela continua pendente. */
  recordFailure(id: string): Promise<void>;
}

export interface OutboxStore {
  inTransaction<T>(work: (batch: OutboxBatch) => Promise<T>): Promise<T>;
}

/**
 * A transação vale para um lote: o tempo de publicar até 100 jobs no Redis, cada um com o
 * limite de `PUBLISH_TIMEOUT_MS`, folgado.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaClient) {}

  inTransaction<T>(work: (batch: OutboxBatch) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(new PrismaOutboxBatch(tx)), TRANSACTION_OPTIONS);
  }
}

class PrismaOutboxBatch implements OutboxBatch {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** Usa o índice parcial `outbox(created_at) WHERE published_at IS NULL`. */
  lockPending(limit: number): Promise<PendingOutboxRow[]> {
    return this.tx.$queryRaw<PendingOutboxRow[]>`
      SELECT id, type, payload, attempts FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
  }

  async markPublished(ids: readonly string[], publishedAt: Date): Promise<void> {
    await this.tx.outbox.updateMany({ where: { id: { in: [...ids] } }, data: { publishedAt } });
  }

  async recordFailure(id: string): Promise<void> {
    await this.tx.outbox.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }
}
