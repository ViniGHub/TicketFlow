import { JwtService } from '@nestjs/jwt';
import { type PrismaClient } from '@ticketflow/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailAlreadyRegisteredError, InvalidCredentialsError } from './auth.errors';
import { AuthService } from './auth.service';
import { type PasswordHasher } from './password-hasher';

// O fluxo completo, com banco real, está em auth.int-spec.ts. Aqui ficam as decisões do
// serviço que não dependem do Postgres.

const user = {
  id: '019a0000-0000-7000-8000-0000000000aa',
  email: 'ana@exemplo.com',
  name: 'Ana',
  roles: ['BUYER'],
};
const registerInput = {
  email: user.email,
  password: 'uma-senha-forte',
  name: 'Ana',
  roles: ['BUYER' as const],
};

function setup() {
  const prisma = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    refreshToken: { create: vi.fn().mockResolvedValue({}) },
  };
  const hasher = {
    hash: vi.fn().mockResolvedValue('$argon2id$hash'),
    verify: vi.fn(),
    verifyAgainstDummy: vi.fn().mockResolvedValue(false),
  };
  const jwt = new JwtService({ secret: 'x'.repeat(32) });
  const service = new AuthService(
    prisma as unknown as PrismaClient,
    hasher as unknown as PasswordHasher,
    jwt,
  );
  return { prisma, hasher, jwt, service };
}

describe('AuthService', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('cadastro grava o hash, nunca a senha, e emite a sessão', async () => {
    ctx.prisma.user.create.mockResolvedValue(user);

    const session = await ctx.service.register(registerInput);

    const { data } = ctx.prisma.user.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.passwordHash).toBe('$argon2id$hash');
    expect(JSON.stringify(data)).not.toContain('uma-senha-forte');
    expect(session.user).toEqual(user);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(ctx.jwt.verifyAsync(session.accessToken)).resolves.toMatchObject({
      sub: user.id,
      roles: ['BUYER'],
    });
  });

  it('cadastro com e-mail repetido vira EmailAlreadyRegisteredError', async () => {
    ctx.prisma.user.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(ctx.service.register(registerInput)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it('outros erros do banco no cadastro passam adiante', async () => {
    ctx.prisma.user.create.mockRejectedValue(new Error('conexão caiu'));

    await expect(ctx.service.register(registerInput)).rejects.toThrow('conexão caiu');
  });

  it('login com e-mail inexistente gasta o tempo de um hash e falha igual à senha errada', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      ctx.service.login({ email: 'ninguem@exemplo.com', password: 'x' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(ctx.hasher.verifyAgainstDummy).toHaveBeenCalledOnce();
  });

  it('login com senha errada não emite sessão', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ ...user, passwordHash: '$argon2id$hash' });
    ctx.hasher.verify.mockResolvedValue(false);

    await expect(
      ctx.service.login({ email: user.email, password: 'errada' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(ctx.prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('login certo devolve o usuário sem o hash da senha', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ ...user, passwordHash: '$argon2id$hash' });
    ctx.hasher.verify.mockResolvedValue(true);

    const session = await ctx.service.login({ email: user.email, password: 'certa' });

    expect(session.user).toEqual(user);
  });
});
