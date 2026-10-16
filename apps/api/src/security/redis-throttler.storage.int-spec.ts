import { setTimeout as sleep } from 'node:timers/promises';

import { flushRedis } from '@ticketflow/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { RedisThrottlerStorage } from './redis-throttler.storage';

const redisUrl = inject('redisUrl');
const redis = new Redis(redisUrl);
const storage = new RedisThrottlerStorage(redis);

afterAll(() => {
  redis.disconnect();
});

beforeEach(async () => {
  await flushRedis(redisUrl);
});

describe('RedisThrottlerStorage', () => {
  it('conta as requisições da janela e bloqueia acima do limite', async () => {
    const hits = [];
    for (let i = 0; i < 4; i += 1) {
      hits.push(await storage.increment('chave', 60_000, 3, 0, 'default'));
    }

    expect(hits.map((hit) => hit.isBlocked)).toEqual([false, false, false, true]);
    expect(hits[0]).toMatchObject({ totalHits: 1, timeToExpire: 60, timeToBlockExpire: 0 });
    expect(hits[3]).toMatchObject({ totalHits: 4, timeToBlockExpire: 60 });
  });

  it('continua bloqueado durante o bloqueio e libera depois', async () => {
    for (let i = 0; i < 3; i += 1) {
      await storage.increment('chave', 300, 2, 300, 'default');
    }
    expect((await storage.increment('chave', 300, 2, 300, 'default')).isBlocked).toBe(true);

    await sleep(400);

    expect((await storage.increment('chave', 300, 2, 300, 'default')).isBlocked).toBe(false);
  });

  it('separa as contagens por chave e por nome de limite', async () => {
    await storage.increment('a', 60_000, 1, 0, 'default');

    expect((await storage.increment('b', 60_000, 1, 0, 'default')).totalHits).toBe(1);
    expect((await storage.increment('a', 60_000, 1, 0, 'outro')).totalHits).toBe(1);
  });

  it('é atômico: requisições simultâneas não ultrapassam o limite sem bloquear', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => storage.increment('rajada', 60_000, 5, 0, 'default')),
    );

    expect(results.filter((result) => !result.isBlocked)).toHaveLength(5);
  });
});
