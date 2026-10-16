import { type INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { healthLiveResponseSchema } from '@ticketflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';

describe('GET /health/live', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Adapter importado estaticamente: sem isso o Nest carrega o Express sob demanda dentro
    // deste hook, e o carregamento a frio estoura o timeout com a máquina sob carga.
    app = moduleRef.createNestApplication(new ExpressAdapter(), { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com o contrato de liveness', async () => {
    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    expect(healthLiveResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });
});
