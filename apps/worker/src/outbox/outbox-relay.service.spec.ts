import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type OutboxRelay, type RelayBatchResult } from './outbox-relay';
import { OutboxRelayService } from './outbox-relay.service';

const INTERVAL_MS = 1_000;
const empty: RelayBatchResult = { published: 0, failed: 0, full: false };
const full: RelayBatchResult = { published: 100, failed: 0, full: true };

/** Relay de mentira: devolve os resultados na ordem dada, e depois lote vazio. */
function fakeRelay(...results: (RelayBatchResult | Error)[]) {
  const relayBatch = vi.fn(() => {
    const next = results.shift() ?? empty;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { relay: { relayBatch } as unknown as OutboxRelay, relayBatch };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loop do relay da outbox', () => {
  it('roda um lote na subida e depois um a cada intervalo', async () => {
    const { relay, relayBatch } = fakeRelay();
    const service = new OutboxRelayService(relay, INTERVAL_MS);

    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(relayBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(relayBatch).toHaveBeenCalledTimes(2);

    await service.beforeApplicationShutdown();
  });

  it('lote cheio dispara o próximo na hora, sem esperar o intervalo', async () => {
    const { relay, relayBatch } = fakeRelay(full, full, empty);
    const service = new OutboxRelayService(relay, INTERVAL_MS);

    service.onApplicationBootstrap();
    // 10 ms, bem abaixo do intervalo: os dois lotes cheios e o vazio seguinte rodam nesse tempo.
    for (let ms = 0; ms < 10; ms += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(relayBatch).toHaveBeenCalledTimes(3);
    await service.beforeApplicationShutdown();
  });

  it('erro num ciclo não para o loop', async () => {
    const { relay, relayBatch } = fakeRelay(new Error('banco fora'));
    const service = new OutboxRelayService(relay, INTERVAL_MS);

    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(relayBatch).toHaveBeenCalledTimes(2);
    await service.beforeApplicationShutdown();
  });

  it('no shutdown espera o lote em andamento e não agenda outro', async () => {
    let finish: (result: RelayBatchResult) => void = () => undefined;
    const { relay, relayBatch } = fakeRelay();
    relayBatch.mockImplementationOnce(
      () => new Promise<RelayBatchResult>((resolve) => (finish = resolve)),
    );
    const service = new OutboxRelayService(relay, INTERVAL_MS);
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const shutdown = service.beforeApplicationShutdown().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish(empty);
    await shutdown;
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);

    expect(stopped).toBe(true);
    expect(service.isRunning).toBe(false);
    expect(relayBatch).toHaveBeenCalledTimes(1);
  });
});
