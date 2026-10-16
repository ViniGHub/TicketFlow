import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaClient } from '@ticketflow/db';
import { type Redis } from 'ioredis';

import { REDIS } from '../redis/redis.module';

/** Tempo máximo de cada verificação: um banco travado não pode travar o /health/ready. */
export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

const logger = new Logger('HealthCheck');

/**
 * O /health/ready é público: a resposta diz só que a dependência caiu. O erro real (que pode
 * trazer host, usuário ou detalhes do driver) vai para o log.
 */
async function probe(dependency: string, check: () => Promise<unknown>): Promise<void> {
  try {
    await check();
  } catch (error) {
    logger.warn({ err: error }, `${dependency} indisponível`);
    // A resposta usa só a mensagem; a causa fica no erro para quem depurar.
    throw new Error(`${dependency} indisponível`, { cause: error });
  }
}

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly health: HealthIndicatorService,
  ) {}

  isHealthy() {
    return this.health
      .check('database')
      .attempt(() => probe('Banco', () => this.prisma.$queryRaw`SELECT 1`))
      .withTimeout(HEALTH_CHECK_TIMEOUT_MS);
  }
}

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly health: HealthIndicatorService,
  ) {}

  isHealthy() {
    return this.health
      .check('redis')
      .attempt(() => probe('Redis', () => this.redis.ping()))
      .withTimeout(HEALTH_CHECK_TIMEOUT_MS);
  }
}
