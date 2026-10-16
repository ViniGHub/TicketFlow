import { describe, expect, it } from 'vitest';

import { InvalidEnvError, parseApiEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://ticketflow:ticketflow@localhost:5432/ticketflow',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  APP_URL: 'http://localhost:3001',
};

describe('parseApiEnv', () => {
  it('aceita um ambiente válido e aplica os padrões', () => {
    const env = parseApiEnv(validEnv);

    expect(env.API_PORT).toBe(3000);
    expect(env.RESERVATION_TTL_MINUTES).toBe(30);
    expect(env.NODE_ENV).toBe('development');
  });

  it('converte números vindos como texto', () => {
    expect(parseApiEnv({ ...validEnv, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('recusa variável obrigatória ausente, citando o nome', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = validEnv;

    expect(() => parseApiEnv(withoutDatabase)).toThrow(InvalidEnvError);
    expect(() => parseApiEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['JWT_SECRET curto', { JWT_SECRET: 'curto' }],
    ['URL de banco que não é Postgres', { DATABASE_URL: 'mysql://localhost/db' }],
    ['chave do Stripe sem prefixo sk_', { STRIPE_SECRET_KEY: 'pk_test_123' }],
  ])('recusa %s', (_case, override) => {
    expect(() => parseApiEnv({ ...validEnv, ...override })).toThrow(InvalidEnvError);
  });
});
