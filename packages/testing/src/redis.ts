import { RedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

/** Mesma imagem do docker-compose.yml. */
export const REDIS_IMAGE = 'redis:8-alpine';

export interface StartedRedis {
  url: string;
  stop(): Promise<void>;
}

export async function startRedis(): Promise<StartedRedis> {
  const container = await new RedisContainer(REDIS_IMAGE).start();

  return {
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}

/** Apaga todas as chaves. Use entre testes para isolar o estado das filas. */
export async function flushRedis(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  try {
    await redis.flushall();
  } finally {
    redis.disconnect();
  }
}
