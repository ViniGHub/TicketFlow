import { createHash, randomBytes } from 'node:crypto';

/** Access token (JWT): curto, porque não é revogável antes de expirar. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh token opaco, rotacionado a cada uso. */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ACCESS_COOKIE = 'tf_access';
export const REFRESH_COOKIE = 'tf_refresh';

/** 32 bytes aleatórios em base64url: é o valor que vai no cookie. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * O banco guarda só o SHA-256 do refresh token. Para um valor aleatório de 256 bits, um hash
 * rápido basta: não há dicionário a atacar, ao contrário de uma senha.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface StoredRefreshToken {
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RefreshDecision = 'valid' | 'not_found' | 'expired' | 'reused';

/**
 * O que fazer com o refresh token apresentado. Um token já revogado (rotacionado ou de
 * sessão encerrada) indica roubo ou replay: a família inteira precisa ser revogada.
 */
export function decideRefresh(token: StoredRefreshToken | null, now: Date): RefreshDecision {
  if (!token) {
    return 'not_found';
  }
  if (token.revokedAt) {
    return 'reused';
  }
  if (token.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}
