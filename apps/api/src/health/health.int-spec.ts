import { afterEach, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp, testEnv } from '../../test/app';

// Portas onde nada escuta: simulam o Postgres e o Redis fora do ar.
const DATABASE_DOWN = 'postgresql://ticketflow:ticketflow@127.0.0.1:1/ticketflow';
const REDIS_DOWN = 'redis://127.0.0.1:1';

let api: TestApp | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function ready(overrides: Record<string, string> = {}) {
  api = await startTestApp(testEnv(overrides));
  const response = await fetch(`${api.url}/health/ready`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /health/ready', () => {
  it('responde 200 com o Postgres e o Redis de pé', async () => {
    const { status, body } = await ready();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('responde 503 com o Postgres fora', async () => {
    const { status, body } = await ready({ DATABASE_URL: DATABASE_DOWN });

    expect(status).toBe(503);
    expect(body).toMatchObject({
      status: 'error',
      error: { database: { status: 'down', message: 'Banco indisponível' } },
      info: { redis: { status: 'up' } },
    });
  });

  it('responde 503 com o Redis fora', async () => {
    const { status, body } = await ready({ REDIS_URL: REDIS_DOWN });

    expect(status).toBe(503);
    // Sem a mensagem: dependendo do intervalo de reconexão do ioredis, a verificação falha
    // por erro de conexão ou pelo timeout de 2 s.
    expect(body).toMatchObject({
      status: 'error',
      error: { redis: { status: 'down' } },
      info: { database: { status: 'up' } },
    });
  });
});

describe('GET /health/live', () => {
  it('continua 200 mesmo com as dependências fora', async () => {
    api = await startTestApp(testEnv({ DATABASE_URL: DATABASE_DOWN, REDIS_URL: REDIS_DOWN }));

    expect((await fetch(`${api.url}/health/live`)).status).toBe(200);
  });
});

describe('Swagger', () => {
  it('publica o OpenAPI em /docs-json com as rotas de autenticação', async () => {
    api = await startTestApp();

    const document = (await (await fetch(`${api.url}/docs-json`)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/refresh',
        '/auth/logout',
        '/me',
      ]),
    );
  });
});
