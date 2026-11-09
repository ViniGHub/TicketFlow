import { EventEmitter } from 'node:events';

import { type Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BullMqJobPublisher } from './job-publisher';

/** Fila de mentira: registra o `add` e responde como configurado. */
function fakeQueue(name: string, respond: () => Promise<unknown> = () => Promise.resolve({})) {
  const add = vi.fn((_name: string, _data: unknown, _options: unknown) => respond());
  const queue = Object.assign(new EventEmitter(), { name, add }) as unknown as Queue;
  return { queue, add };
}

const silentLogger = { warn: vi.fn() } as never;

afterEach(() => {
  vi.useRealTimers();
});

describe('publicação de jobs no BullMQ', () => {
  it('publica na fila do tipo, com jobId igual ao id da linha da outbox', async () => {
    const email = fakeQueue('send-ticket-email');
    const refund = fakeQueue('refund-order');
    const publisher = new BullMqJobPublisher([email.queue, refund.queue], 5_000, silentLogger);

    await publisher.publish({
      type: 'refund-order',
      jobId: 'outbox-1',
      payload: { orderId: 'p1' },
    });

    expect(refund.add).toHaveBeenCalledWith(
      'refund-order',
      { orderId: 'p1' },
      { jobId: 'outbox-1' },
    );
    expect(email.add).not.toHaveBeenCalled();
  });

  it('tipo sem fila registrada é erro', async () => {
    const publisher = new BullMqJobPublisher(
      [fakeQueue('refund-order').queue],
      5_000,
      silentLogger,
    );

    await expect(
      publisher.publish({ type: 'send-ticket-email', jobId: 'outbox-1', payload: {} }),
    ).rejects.toThrow(/Nenhuma fila/);
  });

  it('publicação que não responde falha no limite, para não segurar a transação', async () => {
    vi.useFakeTimers();
    const stuck = fakeQueue('refund-order', () => new Promise<never>(() => undefined));
    const publisher = new BullMqJobPublisher([stuck.queue], 5_000, silentLogger);

    const result = publisher.publish({ type: 'refund-order', jobId: 'outbox-1', payload: {} });
    const assertion = expect(result).rejects.toThrow(/5000 ms/);
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });

  it('erro de conexão da fila vai para o log em vez de derrubar o processo', () => {
    const logger = { warn: vi.fn() };
    const { queue } = fakeQueue('refund-order');
    new BullMqJobPublisher([queue], 5_000, logger as never);

    queue.emit('error', new Error('ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'refund-order', error: 'ECONNREFUSED' }),
    );
  });
});
