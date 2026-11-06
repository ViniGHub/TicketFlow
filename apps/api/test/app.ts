// Helpers dos testes de integração da API: sobem a aplicação real numa porta livre,
// apontando para o Postgres e o Redis do Testcontainers.
import { JwtService } from '@nestjs/jwt';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type Role } from '@ticketflow/contracts';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { inject } from 'vitest';

import { APP_OPTIONS, configureApp } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { type AccessTokenPayload } from '../src/auth/auth.service';
import { ACCESS_COOKIE, ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/session';
import { type ApiEnv, parseApiEnv } from '../src/config/env';
import { PAYMENT_GATEWAY } from '../src/payments/payments.module';

export const FRONT_ORIGIN = 'http://localhost:3001';

export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  return parseApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    APP_URL: FRONT_ORIGIN,
    ...overrides,
  });
}

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  /** O gateway de pagamento da app: um fake em memória, nunca o Stripe. */
  payments: FakePaymentGateway;
  close(): Promise<void>;
}

/**
 * A mesma API do main.ts (AppModule e configureApp), com o `PaymentGateway` trocado pelo
 * `FakePaymentGateway`: nenhum teste fala com o Stripe.
 */
export async function startTestApp(
  env: ApiEnv = testEnv(),
  payments = new FakePaymentGateway(),
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(payments)
    .compile();
  // Adapter explícito pelo mesmo motivo do createApp (carregamento a frio do Express).
  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(),
    APP_OPTIONS,
  );
  configureApp(app, env);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, url: `http://127.0.0.1:${address.port}`, payments, close: () => app.close() };
}

/** Guarda os cookies das respostas e os devolve nas próximas requisições, como um navegador. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = ''] = header.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = /expires=thu, 01 jan 1970/i.test(header) || value === '';
      if (expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/**
 * Loga um usuário já existente (ex.: do seed) e devolve o jar com a sessão. O login tem rate
 * limit de 5/min por IP: zere o Redis entre os testes.
 */
export async function login(baseUrl: string, email: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const response = await call(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
    jar,
  });
  if (response.status !== 200) {
    throw new Error(`Login de ${email} falhou com status ${response.status}`);
  }
  return jar;
}

/**
 * Sessão de um usuário que já existe no banco, sem passar pelo login (5/min por IP): assina
 * o access token como a API assina. Para testes com dezenas de usuários.
 */
export async function sessionFor(
  userId: string,
  roles: Role[],
  env: ApiEnv = testEnv(),
): Promise<CookieJar> {
  const payload: AccessTokenPayload = { sub: userId, roles };
  const token = await new JwtService({ secret: env.JWT_SECRET }).signAsync(payload, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  const jar = new CookieJar();
  jar.set(ACCESS_COOKIE, token);
  return jar;
}

/** Faz uma requisição como o front faria (Origin do front e cookies do jar). */
export async function call(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: unknown; jar?: CookieJar; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: FRONT_ORIGIN, ...init.headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const cookie = init.jar?.header();
  if (cookie) {
    headers.cookie = cookie;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  init.jar?.absorb(response);
  return response;
}
