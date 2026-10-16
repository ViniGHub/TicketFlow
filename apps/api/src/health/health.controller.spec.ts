import { type INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { healthLiveResponseSchema } from '@ticketflow/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';
import { DatabaseHealthIndicator, RedisHealthIndicator } from './health.indicators';

// Indicadores falsos: o comportamento com Postgres e Redis reais está em health.int-spec.ts.
const state = { database: true, redis: true };

function fakeIndicator(key: 'database' | 'redis') {
  return (health: HealthIndicatorService) => ({
    isHealthy: () =>
      health.check(key).attempt(() => {
        if (!state[key]) {
          throw new Error(`${key} fora do ar`);
        }
      }),
  });
}

describe('HealthController', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      controllers: [HealthController],
      providers: [
        {
          provide: DatabaseHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: fakeIndicator('database'),
        },
        {
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: fakeIndicator('redis'),
        },
      ],
    }).compile();
    // Adapter importado estaticamente: sem isso o Nest carrega o Express sob demanda dentro
    // deste hook, e o carregamento a frio estoura o timeout com a máquina sob carga.
    app = moduleRef.createNestApplication(new ExpressAdapter(), { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.database = true;
    state.redis = true;
  });

  it('GET /health/live responde 200 com o contrato de liveness', async () => {
    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    expect(healthLiveResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });

  it('GET /health/ready responde 200 com banco e Redis de pé', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it.each(['database', 'redis'] as const)(
    'GET /health/ready responde 503 dizendo qual dependência caiu (%s)',
    async (down) => {
      state[down] = false;

      const response = await fetch(`${baseUrl}/health/ready`);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: 'error',
        error: { [down]: { status: 'down' } },
      });
    },
  );
});
