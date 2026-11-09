import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JobSchedulers,
  SCHEDULER_RETRY_MS,
  type SchedulerQueue,
  upsertJobSchedulers,
} from './job-schedulers';

/** Fila de mentira: falha nas primeiras `failures` chamadas. */
function fakeQueue(name: string, failures = 0) {
  let calls = 0;
  const upsertJobScheduler = vi.fn(() => {
    calls += 1;
    return calls <= failures
      ? Promise.reject(new Error('Redis fora'))
      : Promise.resolve(undefined as never);
  });
  return { queue: { name, upsertJobScheduler } as unknown as SchedulerQueue, upsertJobScheduler };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('upsertJobSchedulers', () => {
  it('um scheduler por job, com id fixo, o intervalo e as opções dos jobs recorrentes', async () => {
    const expire = fakeQueue('expire-orders');
    const reconcile = fakeQueue('reconcile-stripe');

    await upsertJobSchedulers([expire.queue, reconcile.queue]);

    const opts = { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 1_000 } };
    expect(expire.upsertJobScheduler).toHaveBeenCalledWith(
      'expire-orders',
      { every: 60_000 },
      { name: 'expire-orders', opts },
    );
    expect(reconcile.upsertJobScheduler).toHaveBeenCalledWith(
      'reconcile-stripe',
      { every: 900_000 },
      { name: 'reconcile-stripe', opts },
    );
  });

  it('fila não registrada é erro', async () => {
    await expect(upsertJobSchedulers([fakeQueue('expire-orders').queue])).rejects.toThrow(
      'reconcile-stripe',
    );
  });
});

describe('JobSchedulers', () => {
  it('com o Redis fora, tenta de novo a cada 10 s até registrar', async () => {
    vi.useFakeTimers();
    const expire = fakeQueue('expire-orders', 2);
    const reconcile = fakeQueue('reconcile-stripe');
    const schedulers = new JobSchedulers(expire.queue, reconcile.queue);

    schedulers.onApplicationBootstrap();
    await schedulers.registration;
    expect(expire.upsertJobScheduler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SCHEDULER_RETRY_MS);
    await schedulers.registration;
    expect(expire.upsertJobScheduler).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(SCHEDULER_RETRY_MS);
    await schedulers.registration;
    expect(expire.upsertJobScheduler).toHaveBeenCalledTimes(3);

    // Registrado: nenhuma tentativa a mais.
    await vi.advanceTimersByTimeAsync(SCHEDULER_RETRY_MS * 3);
    expect(expire.upsertJobScheduler).toHaveBeenCalledTimes(3);
  });

  it('no shutdown, para de tentar', async () => {
    vi.useFakeTimers();
    const expire = fakeQueue('expire-orders', Number.POSITIVE_INFINITY);
    const schedulers = new JobSchedulers(expire.queue, fakeQueue('reconcile-stripe').queue);

    schedulers.onApplicationBootstrap();
    await schedulers.registration;
    schedulers.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(SCHEDULER_RETRY_MS * 3);

    expect(expire.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });
});
