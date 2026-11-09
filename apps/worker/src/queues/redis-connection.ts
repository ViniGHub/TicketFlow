import { type RedisOptions } from 'bullmq';

/**
 * Opções de conexão do BullMQ a partir do `REDIS_URL` (`redis://` ou `rediss://`, com usuário,
 * senha e db).
 */
export function redisConnectionOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db,
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(url.protocol === 'rediss:' && { tls: {} }),
  };
}
