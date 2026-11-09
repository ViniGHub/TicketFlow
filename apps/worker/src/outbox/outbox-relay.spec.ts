import { describe, expect, it, vi } from 'vitest';

import { type JobPublisher, type JobToPublish } from '../queues/job-publisher';

import { OutboxRelay } from './outbox-relay';
import { type OutboxBatch, type OutboxStore, type PendingOutboxRow } from './outbox-store';

const NOW = new Date('2026-11-20T12:00:00Z');

interface StoredRow extends PendingOutboxRow {
  publishedAt: Date | null;
}

/** Outbox em memória: a transação desfaz tudo se o trabalho lançar erro. */
class FakeOutbox implements OutboxStore {
  rows: StoredRow[] = [];

  add(id: string, type = 'send-ticket-email', payload: unknown = { orderId: `pedido-${id}` }) {
    this.rows.push({ id, type, payload, attempts: 0, publishedAt: null });
  }

  row(id: string): StoredRow | undefined {
    return this.rows.find((row) => row.id === id);
  }

  async inTransaction<T>(work: (batch: OutboxBatch) => Promise<T>): Promise<T> {
    const snapshot = this.rows.map((row) => ({ ...row }));
    try {
      return await work({
        lockPending: (limit) =>
          Promise.resolve(this.rows.filter((row) => row.publishedAt === null).slice(0, limit)),
        markPublished: (ids, publishedAt) => {
          for (const row of this.rows) {
            if (ids.includes(row.id)) {
              row.publishedAt = publishedAt;
            }
          }
          return Promise.resolve();
        },
        recordFailure: (id) => {
          const row = this.row(id);
          if (row) {
            row.attempts += 1;
          }
          return Promise.resolve();
        },
      });
    } catch (error) {
      this.rows = snapshot;
      throw error;
    }
  }
}

/** Publicador de mentira: registra os jobs; falha nos ids configurados. */
class FakePublisher implements JobPublisher {
  published: JobToPublish[] = [];
  failOn = new Set<string>();

  publish(job: JobToPublish): Promise<void> {
    if (this.failOn.has(job.jobId)) {
      return Promise.reject(new Error('Redis fora'));
    }
    this.published.push(job);
    return Promise.resolve();
  }
}

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(batchSize = 100) {
  const outbox = new FakeOutbox();
  const publisher = new FakePublisher();
  const relay = new OutboxRelay(outbox, publisher, batchSize, () => NOW, logger as never);
  return { outbox, publisher, relay };
}

describe('relay da outbox', () => {
  it('publica as linhas pendentes com jobId = id da linha e marca published_at', async () => {
    const { outbox, publisher, relay } = setup();
    outbox.add('o1');
    outbox.add('o2', 'refund-order', { orderId: 'pedido-9' });

    const result = await relay.relayBatch();

    expect(result).toEqual({ published: 2, failed: 0, full: false });
    expect(publisher.published).toEqual([
      { type: 'send-ticket-email', jobId: 'o1', payload: { orderId: 'pedido-o1' } },
      { type: 'refund-order', jobId: 'o2', payload: { orderId: 'pedido-9' } },
    ]);
    expect(outbox.row('o1')?.publishedAt).toEqual(NOW);
    expect(outbox.row('o2')?.publishedAt).toEqual(NOW);
  });

  it('linha já publicada não sai de novo', async () => {
    const { outbox, publisher, relay } = setup();
    outbox.add('o1');

    await relay.relayBatch();
    const second = await relay.relayBatch();

    expect(second).toEqual({ published: 0, failed: 0, full: false });
    expect(publisher.published).toHaveLength(1);
  });

  it('respeita o tamanho do lote e avisa que ele veio cheio', async () => {
    const { outbox, publisher, relay } = setup(2);
    outbox.add('o1');
    outbox.add('o2');
    outbox.add('o3');

    const first = await relay.relayBatch();
    const second = await relay.relayBatch();

    expect(first).toEqual({ published: 2, failed: 0, full: true });
    expect(second).toEqual({ published: 1, failed: 0, full: false });
    expect(publisher.published.map((job) => job.jobId)).toEqual(['o1', 'o2', 'o3']);
  });

  it('falha ao publicar: para o lote, mantém as anteriores e soma uma tentativa', async () => {
    const { outbox, publisher, relay } = setup();
    outbox.add('o1');
    outbox.add('o2');
    outbox.add('o3');
    publisher.failOn.add('o2');

    const result = await relay.relayBatch();

    expect(result).toEqual({ published: 1, failed: 1, full: false });
    expect(outbox.row('o1')?.publishedAt).toEqual(NOW);
    expect(outbox.row('o2')).toMatchObject({ publishedAt: null, attempts: 1 });
    // A seguinte nem foi tentada: com o Redis fora, também falharia.
    expect(outbox.row('o3')).toMatchObject({ publishedAt: null, attempts: 0 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'o2', orderId: 'pedido-o2', attempts: 1 }),
    );
  });

  it('o Redis de volta: a linha que falhou é publicada no ciclo seguinte', async () => {
    const { outbox, publisher, relay } = setup();
    outbox.add('o1');
    publisher.failOn.add('o1');
    await relay.relayBatch();

    publisher.failOn.clear();
    const retry = await relay.relayBatch();

    expect(retry).toEqual({ published: 1, failed: 0, full: false });
    expect(outbox.row('o1')).toMatchObject({ publishedAt: NOW, attempts: 1 });
  });

  it('tipo desconhecido não é publicado nem trava as outras linhas', async () => {
    const { outbox, publisher, relay } = setup();
    outbox.add('o1', 'job-inventado');
    outbox.add('o2');

    const result = await relay.relayBatch();

    expect(result).toEqual({ published: 1, failed: 1, full: false });
    expect(publisher.published.map((job) => job.jobId)).toEqual(['o2']);
    expect(outbox.row('o1')).toMatchObject({ publishedAt: null, attempts: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'o1', jobType: 'job-inventado' }),
    );
  });

  it('payload sem orderId não quebra o log', async () => {
    const { outbox, relay } = setup();
    outbox.add('o1', 'send-ticket-email', null);

    await expect(relay.relayBatch()).resolves.toMatchObject({ published: 1 });
  });
});
