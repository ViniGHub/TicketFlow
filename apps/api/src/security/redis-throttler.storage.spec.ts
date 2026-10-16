import { ServiceUnavailableException } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { RedisThrottlerStorage } from './redis-throttler.storage';

// O comportamento contra um Redis real está em redis-throttler.storage.int-spec.ts.

describe('RedisThrottlerStorage', () => {
  it('converte o resultado do script (ms) para o formato do throttler (s)', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([3, 59_001, 0]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('k', 60_000, 5, 0, 'default')).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Sem blockDuration, o bloqueio dura uma janela.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'throttle:default:k',
      'throttle:default:k:blocked',
      60_000,
      5,
      60_000,
    );
  });

  it('com o Redis fora, responde 503 em vez de liberar a rota', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('k', 60_000, 5, 0, 'default')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
