import { type Job, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { jobFields, LoggedProcessor } from './logged-processor';

class TestProcessor extends LoggedProcessor {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

function setup() {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, processor: new TestProcessor(logger as never) };
}

function job(attemptsMade: number, attempts = 5): Job {
  return {
    id: 'outbox-1',
    queueName: 'send-ticket-email',
    data: { orderId: 'pedido-1' },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job;
}

describe('log dos jobs', () => {
  it('falha com tentativas sobrando é aviso', () => {
    const { logger, processor } = setup();

    processor.onJobFailed(job(2), new Error('SMTP fora'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'outbox-1',
        orderId: 'pedido-1',
        attempt: 2,
        attempts: 5,
        error: 'SMTP fora',
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a última tentativa que falha é erro: o job fica em failed', () => {
    const { logger, processor } = setup();

    processor.onJobFailed(job(5), new Error('SMTP fora'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Job esgotou as tentativas e ficou em failed',
        jobId: 'outbox-1',
        orderId: 'pedido-1',
      }),
    );
  });

  it('UnrecoverableError na primeira tentativa já é erro: o BullMQ não repete', () => {
    const { logger, processor } = setup();

    processor.onJobFailed(job(1), new UnrecoverableError('payload inválido'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Job sem como dar certo; ficou em failed',
        jobId: 'outbox-1',
        error: 'payload inválido',
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falha sem o job registrado também vai para o log de erro', () => {
    const { logger, processor } = setup();

    processor.onJobFailed(undefined, new Error('job sumiu'));

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: 'job sumiu' }));
  });

  it('conclusão vai para o log com jobId e orderId', () => {
    const { logger, processor } = setup();

    processor.onJobCompleted(job(1));

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Job concluído', jobId: 'outbox-1', orderId: 'pedido-1' }),
    );
  });

  it('payload sem orderId: só jobId e fila', () => {
    const fields = jobFields({ id: 'j1', queueName: 'refund-order', data: {} } as unknown as Job);

    expect(fields).toEqual({ jobId: 'j1', queue: 'refund-order' });
  });
});
