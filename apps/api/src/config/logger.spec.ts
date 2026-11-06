import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { parseApiEnv } from './env';
import { loggerParams } from './logger';

const env = parseApiEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/t',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  STRIPE_SECRET_KEY: 'sk_test_1',
  STRIPE_WEBHOOK_SECRET: 'whsec_1',
  APP_URL: 'http://localhost:3001',
});

/** Loga uma linha com a configuração de redação da API e devolve o JSON gravado. */
function logLine(fields: Record<string, unknown>): Record<string, unknown> {
  const { pinoHttp } = loggerParams(env);
  const redact = pinoHttp && 'redact' in pinoHttp ? pinoHttp.redact : undefined;
  let line = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      line += chunk.toString();
      done();
    },
  });
  pino({ redact }, stream).info(fields, 'requisição');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('logs da API', () => {
  it('mascaram cookies, Authorization e a assinatura do webhook do Stripe (regra 11)', () => {
    const line = logLine({
      req: {
        headers: {
          cookie: 'tf_access=segredo',
          authorization: 'Bearer segredo',
          'stripe-signature': 't=1,v1=assinatura',
          'content-type': 'application/json',
        },
      },
      res: { headers: { 'set-cookie': 'tf_refresh=segredo' } },
    });

    expect(line).toMatchObject({
      req: {
        headers: {
          cookie: '[REDACTED]',
          authorization: '[REDACTED]',
          'stripe-signature': '[REDACTED]',
          'content-type': 'application/json',
        },
      },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
    });
  });
});
