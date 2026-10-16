// Helpers dos testes de integração da API: sobem a aplicação real (createApp) numa porta
// livre, apontando para o Postgres e o Redis do Testcontainers.
import { type NestExpressApplication } from '@nestjs/platform-express';
import { inject } from 'vitest';

import { createApp } from '../src/app.factory';
import { type ApiEnv, parseApiEnv } from '../src/config/env';

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
  close(): Promise<void>;
}

export async function startTestApp(env: ApiEnv = testEnv()): Promise<TestApp> {
  const app = await createApp(env);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
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
