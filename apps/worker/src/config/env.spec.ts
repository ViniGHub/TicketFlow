import { describe, expect, it } from 'vitest';

import { InvalidEnvError, parseWorkerEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://ticketflow:ticketflow@localhost:5432/ticketflow',
  REDIS_URL: 'redis://localhost:6379',
  STRIPE_SECRET_KEY: 'sk_test_123',
  APP_URL: 'http://localhost:3001',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  EMAIL_FROM: 'ingressos@ticketflow.local',
};

describe('parseWorkerEnv', () => {
  it('aceita um ambiente válido e converte a porta SMTP', () => {
    const env = parseWorkerEnv(validEnv);

    expect(env.SMTP_PORT).toBe(1025);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('trata RESEND_API_KEY vazia como ausente', () => {
    expect(parseWorkerEnv({ ...validEnv, RESEND_API_KEY: '' }).RESEND_API_KEY).toBeUndefined();
    expect(parseWorkerEnv({ ...validEnv, RESEND_API_KEY: 're_123' }).RESEND_API_KEY).toBe('re_123');
  });

  it('recusa variável obrigatória ausente, citando o nome', () => {
    const { REDIS_URL: _omitted, ...withoutRedis } = validEnv;

    expect(() => parseWorkerEnv(withoutRedis)).toThrow(/REDIS_URL/);
  });

  it('recusa remetente de e-mail inválido', () => {
    expect(() => parseWorkerEnv({ ...validEnv, EMAIL_FROM: 'sem-arroba' })).toThrow(
      InvalidEnvError,
    );
  });
});
