import { ServiceUnavailableException } from '@nestjs/common';
import { type ThrottlerStorage } from '@nestjs/throttler';
import { type ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { type Redis } from 'ioredis';

/**
 * Janela fixa por chave, atômica no Redis. KEYS[1] conta as requisições da janela; KEYS[2]
 * marca o bloqueio. Ao bloquear, a contagem recomeça, como no storage em memória do Nest.
 * ARGV: ttl (ms), limite, duração do bloqueio (ms). Retorna {hits, ttl ms, bloqueio ms}.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  blockTtl = tonumber(ARGV[3])
end
if ttl < 0 then ttl = 0 end
if blockTtl < 0 then blockTtl = 0 end
return {hits, ttl, blockTtl}
`;

const toSeconds = (milliseconds: number): number => Math.ceil(milliseconds / 1000);

/**
 * Storage do @nestjs/throttler em Redis, para o limite valer entre várias instâncias da API.
 * Escrito aqui porque a biblioteca pronta (@nest-lab/throttler-storage-redis) não suporta o
 * NestJS 12.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'throttle',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `${this.prefix}:${throttlerName}:${key}`;
    let result: [number, number, number];
    try {
      result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        `${hitsKey}:blocked`,
        ttl,
        limit,
        blockDuration > 0 ? blockDuration : ttl,
      )) as [number, number, number];
    } catch {
      // Sem Redis não há como contar tentativas. Liberar abriria espaço para força bruta no
      // login, então a rota protegida responde 503 até o Redis voltar.
      throw new ServiceUnavailableException({
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
      });
    }
    const [totalHits, ttlMs, blockMs] = result;

    return {
      totalHits,
      timeToExpire: toSeconds(ttlMs),
      isBlocked: blockMs > 0,
      timeToBlockExpire: toSeconds(blockMs),
    };
  }
}
