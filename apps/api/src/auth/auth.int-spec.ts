import { createPrismaClient } from '@ticketflow/db';
import { DEV_PASSWORD, seed } from '@ticketflow/db/seed';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, CookieJar, startTestApp, type TestApp } from '../../test/app';

import { ACCESS_COOKIE, REFRESH_COOKIE } from './session';

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);

const ana = { email: 'Ana@Exemplo.com', password: 'uma-senha-forte', name: 'Ana Souza' };

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp();
});

afterAll(async () => {
  await api.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  // Zera também os contadores do rate limit entre os testes.
  await flushRedis(redisUrl);
});

async function register(jar = new CookieJar()): Promise<CookieJar> {
  const response = await call(api.url, '/auth/register', { method: 'POST', body: ana, jar });
  expect(response.status).toBe(201);
  return jar;
}

async function refresh(jar: CookieJar): Promise<Response> {
  return call(api.url, '/auth/refresh', { method: 'POST', jar });
}

describe('fluxo de sessão', () => {
  it('register → /me → login → refresh → logout', async () => {
    const jar = new CookieJar();

    const registered = await call(api.url, '/auth/register', { method: 'POST', body: ana, jar });
    expect(registered.status).toBe(201);
    const user = (await registered.json()) as { id: string; email: string; roles: string[] };
    expect(user).toMatchObject({ email: 'ana@exemplo.com', name: 'Ana Souza', roles: ['BUYER'] });
    expect(jar.get(ACCESS_COOKIE)).toBeDefined();
    expect(jar.get(REFRESH_COOKIE)).toBeDefined();

    const me = await call(api.url, '/me', { jar });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: user.id,
      email: 'ana@exemplo.com',
      name: 'Ana Souza',
      roles: ['BUYER'],
    });

    const loggedIn = await call(api.url, '/auth/login', {
      method: 'POST',
      body: { email: 'ana@exemplo.com', password: ana.password },
      jar,
    });
    expect(loggedIn.status).toBe(200);

    const before = jar.get(REFRESH_COOKIE);
    const refreshed = await refresh(jar);
    expect(refreshed.status).toBe(200);
    expect(jar.get(REFRESH_COOKIE)).not.toBe(before);

    const loggedOut = await call(api.url, '/auth/logout', { method: 'POST', jar });
    expect(loggedOut.status).toBe(204);
    expect(jar.get(ACCESS_COOKIE)).toBeUndefined();
    expect(jar.get(REFRESH_COOKIE)).toBeUndefined();
  });

  it('define os cookies como httpOnly, Secure e SameSite=Lax, com o refresh restrito a /auth', async () => {
    const response = await call(api.url, '/auth/register', { method: 'POST', body: ana });
    const cookies = response.headers.getSetCookie();

    const access = cookies.find((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=`)) ?? '';
    const refreshCookie = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`)) ?? '';
    for (const cookie of [access, refreshCookie]) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refreshCookie).toMatch(/Path=\/auth(;|$)/);
  });

  it('o refresh token é guardado só como hash', async () => {
    const jar = await register();

    const stored = await prisma.refreshToken.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(jar.get(REFRESH_COOKIE));
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('depois do logout o refresh token não vale mais', async () => {
    const jar = await register();
    const oldRefresh = jar.get(REFRESH_COOKIE) as string;
    await call(api.url, '/auth/logout', { method: 'POST', jar });

    const stale = new CookieJar();
    stale.set(REFRESH_COOKIE, oldRefresh);
    expect((await refresh(stale)).status).toBe(401);
  });
});

describe('rotação do refresh token', () => {
  it('reuso de um token já rotacionado revoga a família inteira', async () => {
    const jar = await register();
    const first = jar.get(REFRESH_COOKIE) as string;
    expect((await refresh(jar)).status).toBe(200);
    const second = jar.get(REFRESH_COOKIE) as string;

    // Alguém reapresenta o primeiro token (roubado): reuso detectado.
    const attacker = new CookieJar();
    attacker.set(REFRESH_COOKIE, first);
    const reused = await refresh(attacker);
    expect(reused.status).toBe(401);
    expect(await reused.json()).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

    // O token legítimo mais recente também deixou de valer.
    const legit = new CookieJar();
    legit.set(REFRESH_COOKIE, second);
    expect((await refresh(legit)).status).toBe(401);

    const family = await prisma.refreshToken.findMany();
    expect(family).toHaveLength(2);
    expect(family.every((token) => token.revokedAt !== null)).toBe(true);
    expect(new Set(family.map((token) => token.familyId)).size).toBe(1);
  });

  it('cada rotação aponta para o token que a substituiu', async () => {
    const jar = await register();
    await refresh(jar);

    const tokens = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(tokens[0]?.replacedById).toBe(tokens[1]?.id);
    expect(tokens[1]?.revokedAt).toBeNull();
  });

  it('refresh sem cookie ou com token desconhecido responde 401', async () => {
    expect((await refresh(new CookieJar())).status).toBe(401);

    const unknown = new CookieJar();
    unknown.set(REFRESH_COOKIE, 'token-que-nao-existe');
    const response = await refresh(unknown);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });
});

describe('cadastro e login', () => {
  it('e-mail já cadastrado (sem diferenciar maiúsculas) responde 409', async () => {
    await register();

    const response = await call(api.url, '/auth/register', {
      method: 'POST',
      body: { ...ana, email: 'ANA@exemplo.com' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('corpo inválido responde 400 com os campos', async () => {
    const response = await call(api.url, '/auth/register', {
      method: 'POST',
      body: { email: 'nao-e-email', password: 'curta', name: '' },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { path: string }[] };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.issues.map((issue) => issue.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('senha errada e e-mail inexistente respondem igual (401)', async () => {
    await register();

    const wrongPassword = await call(api.url, '/auth/login', {
      method: 'POST',
      body: { email: ana.email, password: 'senha-errada' },
    });
    const unknownEmail = await call(api.url, '/auth/login', {
      method: 'POST',
      body: { email: 'ninguem@exemplo.com', password: 'senha-errada' },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const [a, b] = (await Promise.all([wrongPassword.json(), unknownEmail.json()])) as {
      code: string;
      message: string;
    }[];
    expect({ code: a?.code, message: a?.message }).toEqual({ code: b?.code, message: b?.message });
  });

  it('cadastro como organizador e comprador', async () => {
    const response = await call(api.url, '/auth/register', {
      method: 'POST',
      body: { ...ana, roles: ['ORGANIZER', 'BUYER'] },
    });
    expect(await response.json()).toMatchObject({ roles: ['ORGANIZER', 'BUYER'] });
  });

  it('usuário do seed entra com a senha de desenvolvimento', async () => {
    await seed(prisma);

    const response = await call(api.url, '/auth/login', {
      method: 'POST',
      body: { email: 'organizador@ticketflow.local', password: DEV_PASSWORD },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ roles: ['ORGANIZER'] });
  });
});

describe('proteções', () => {
  it('excesso de tentativas de login responde 429', async () => {
    const attempt = () =>
      call(api.url, '/auth/login', {
        method: 'POST',
        body: { email: 'ana@exemplo.com', password: 'chute' },
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('POST de outra origem responde 403', async () => {
    const response = await call(api.url, '/auth/login', {
      method: 'POST',
      body: { email: ana.email, password: ana.password },
      headers: { origin: 'https://malicioso.com' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('/me sem sessão ou com token adulterado responde 401', async () => {
    expect((await call(api.url, '/me')).status).toBe(401);

    const jar = await register();
    jar.set(ACCESS_COOKIE, `${jar.get(ACCESS_COOKIE) ?? ''}x`);
    expect((await call(api.url, '/me', { jar })).status).toBe(401);
  });

  it('devolve o x-request-id recebido, e o mesmo id no corpo do erro', async () => {
    const response = await call(api.url, '/me', { headers: { 'x-request-id': 'teste-abc' } });

    expect(response.headers.get('x-request-id')).toBe('teste-abc');
    expect(await response.json()).toMatchObject({ requestId: 'teste-abc' });
  });
});
