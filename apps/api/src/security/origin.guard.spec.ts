import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { type ApiEnv, parseApiEnv } from '../config/env';

import { OriginGuard } from './origin.guard';

function envFor(nodeEnv: ApiEnv['NODE_ENV']): ApiEnv {
  return parseApiEnv({
    NODE_ENV: nodeEnv,
    DATABASE_URL: 'postgresql://u:p@localhost:5432/t',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(32),
    STRIPE_SECRET_KEY: 'sk_test_1',
    STRIPE_WEBHOOK_SECRET: 'whsec_1',
    APP_URL: 'https://ingressos.exemplo.com/app',
  });
}

function contextFor(method: string, origin?: string): ExecutionContext {
  const request = { method, headers: origin === undefined ? {} : { origin } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  const guard = new OriginGuard(envFor('production'));

  it('libera métodos que não alteram estado, de qualquer origem', () => {
    expect(guard.canActivate(contextFor('GET', 'https://malicioso.com'))).toBe(true);
  });

  it('aceita POST da origem do front (só a origem do APP_URL, sem o caminho)', () => {
    expect(guard.canActivate(contextFor('POST', 'https://ingressos.exemplo.com'))).toBe(true);
  });

  it('aceita POST sem Origin (cliente que não é navegador)', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });

  it.each(['https://malicioso.com', 'null', 'http://localhost:3000'])(
    'recusa POST com Origin %s em produção',
    (origin) => {
      expect(() => guard.canActivate(contextFor('POST', origin))).toThrow(ForbiddenException);
    },
  );

  it('fora de produção aceita a origem da própria API (Swagger)', () => {
    const devGuard = new OriginGuard(envFor('development'));

    expect(devGuard.canActivate(contextFor('DELETE', 'http://localhost:3000'))).toBe(true);
  });
});
