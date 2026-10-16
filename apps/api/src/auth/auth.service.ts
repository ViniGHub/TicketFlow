import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type Role,
} from '@ticketflow/contracts';
import { type Prisma, PrismaClient } from '@ticketflow/db';

import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReusedError,
} from './auth.errors';
import { PasswordHasher } from './password-hasher';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  decideRefresh,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from './session';

/** Conteúdo do access token. `roles` vale até o token expirar (15 min). */
export interface AccessTokenPayload {
  sub: string;
  roles: Role[];
}

/** Sessão emitida: o controller grava os tokens em cookies e devolve só o usuário. */
export interface IssuedSession {
  user: MeResponse;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface LockedRefreshToken {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

type RotationOutcome =
  | { kind: 'rotated'; session: Omit<IssuedSession, 'accessToken'> }
  | { kind: 'reused'; userId: string; familyId: string }
  | { kind: 'invalid' };

const userSelect = { id: true, email: true, name: true, roles: true } as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterRequest): Promise<IssuedSession> {
    const passwordHash = await this.hasher.hash(input.password);
    let user: MeResponse;
    try {
      user = await this.prisma.user.create({
        data: { email: input.email, name: input.name, roles: input.roles, passwordHash },
        select: userSelect,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
    return this.issueSession(user);
  }

  async login(input: LoginRequest): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...userSelect, passwordHash: true },
    });
    const valid = user
      ? await this.hasher.verify(input.password, user.passwordHash)
      : await this.hasher.verifyAgainstDummy(input.password);
    if (!user || !valid) {
      throw new InvalidCredentialsError();
    }
    const { passwordHash: _hash, ...me } = user;
    return this.issueSession(me);
  }

  /**
   * Rotação: o token apresentado é revogado e substituído por um novo da mesma família, numa
   * transação com o registro travado (FOR UPDATE). Token já revogado revoga a família inteira;
   * essa revogação é gravada antes do erro, fora do rollback.
   */
  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    if (!rawToken) {
      throw new InvalidRefreshTokenError();
    }
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx): Promise<RotationOutcome> => {
      const [current] = await tx.$queryRaw<LockedRefreshToken[]>`
        SELECT id, user_id, family_id, expires_at, revoked_at
        FROM refresh_tokens
        WHERE token_hash = ${hashRefreshToken(rawToken)}
        FOR UPDATE`;
      const decision = decideRefresh(
        current ? { expiresAt: current.expires_at, revokedAt: current.revoked_at } : null,
        now,
      );

      if (decision === 'reused' && current) {
        await this.revokeFamily(tx, current.family_id, now);
        return { kind: 'reused', userId: current.user_id, familyId: current.family_id };
      }
      if (decision !== 'valid' || !current) {
        return { kind: 'invalid' };
      }

      const user = await tx.user.findUnique({ where: { id: current.user_id }, select: userSelect });
      if (!user) {
        return { kind: 'invalid' };
      }
      const refreshToken = generateRefreshToken();
      const next = await tx.refreshToken.create({
        data: {
          userId: user.id,
          familyId: current.family_id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { revokedAt: now, replacedById: next.id },
      });
      return { kind: 'rotated', session: { user, refreshToken, refreshExpiresAt: next.expiresAt } };
    });

    if (outcome.kind === 'reused') {
      // Sem o token no log (CLAUDE.md, regra 11): só os identificadores.
      this.logger.warn(
        { userId: outcome.userId, familyId: outcome.familyId },
        'Refresh token reutilizado: família revogada',
      );
      throw new RefreshTokenReusedError();
    }
    if (outcome.kind === 'invalid') {
      throw new InvalidRefreshTokenError();
    }
    return {
      ...outcome.session,
      accessToken: await this.signAccessToken(outcome.session.user),
    };
  }

  /** Encerra a sessão: revoga a família do token (a sessão inteira, não só este token). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      select: { familyId: true },
    });
    if (token) {
      await this.revokeFamily(this.prisma, token.familyId, new Date());
    }
  }

  async me(userId: string): Promise<MeResponse | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  }

  private async issueSession(user: MeResponse): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    return { user, accessToken: await this.signAccessToken(user), refreshToken, refreshExpiresAt };
  }

  private signAccessToken(user: MeResponse): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, roles: user.roles };
    return this.jwt.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  private async revokeFamily(
    client: Prisma.TransactionClient | PrismaClient,
    familyId: string,
    now: Date,
  ): Promise<void> {
    await client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
