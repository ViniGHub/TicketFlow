import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type Role } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { JwtAuthGuard, Roles, RolesGuard } from './auth.guards';
import { ACCESS_COOKIE } from './session';

const secret = 'x'.repeat(32);
const jwt = new JwtService({ secret, verifyOptions: { algorithms: ['HS256'] } });

function contextFor(request: object, handler: () => void = () => undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(jwt);

  it('aceita o access token do cookie e preenche request.user', async () => {
    const token = await jwt.signAsync({ sub: 'user-1', roles: ['BUYER'] });
    const request: { cookies: Record<string, string>; user?: unknown } = {
      cookies: { [ACCESS_COOKIE]: token },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', roles: ['BUYER'] });
  });

  it('recusa sem cookie', async () => {
    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa token assinado com outro segredo', async () => {
    const forged = await new JwtService({ secret: 'y'.repeat(32) }).signAsync({
      sub: 'x',
      roles: [],
    });

    await expect(
      guard.canActivate(contextFor({ cookies: { [ACCESS_COOKIE]: forged } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token expirado', async () => {
    const expired = await jwt.signAsync({ sub: 'x', roles: [] }, { expiresIn: -1 });

    await expect(
      guard.canActivate(contextFor({ cookies: { [ACCESS_COOKIE]: expired } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token sem assinatura (alg none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'x', roles: ['ORGANIZER'] })).toString(
      'base64url',
    );

    await expect(
      guard.canActivate(contextFor({ cookies: { [ACCESS_COOKIE]: `${header}.${body}.` } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  function handlerRequiring(...roles: Role[]): () => void {
    const handler = (): void => undefined;
    Roles(...roles)(handler, 'handler', { value: handler });
    return handler;
  }

  it('libera rota sem @Roles', () => {
    expect(guard.canActivate(contextFor({ user: { id: 'x', roles: [] } }))).toBe(true);
  });

  it('libera quem tem um dos papéis exigidos', () => {
    const request = { user: { id: 'x', roles: ['BUYER', 'ORGANIZER'] } };

    expect(guard.canActivate(contextFor(request, handlerRequiring('ORGANIZER')))).toBe(true);
  });

  it('recusa quem não tem o papel', () => {
    const request = { user: { id: 'x', roles: ['BUYER'] } };

    expect(() => guard.canActivate(contextFor(request, handlerRequiring('ORGANIZER')))).toThrow(
      ForbiddenException,
    );
  });
});
