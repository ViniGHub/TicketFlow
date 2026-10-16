import { describe, expect, it } from 'vitest';

import { decideRefresh, generateRefreshToken, hashRefreshToken } from './session';

const now = new Date('2026-10-16T12:00:00Z');
const later = new Date('2026-10-17T12:00:00Z');
const earlier = new Date('2026-10-15T12:00:00Z');

describe('decideRefresh', () => {
  it('token inexistente', () => {
    expect(decideRefresh(null, now)).toBe('not_found');
  });

  it('token válido', () => {
    expect(decideRefresh({ expiresAt: later, revokedAt: null }, now)).toBe('valid');
  });

  it('token expirado', () => {
    expect(decideRefresh({ expiresAt: now, revokedAt: null }, now)).toBe('expired');
  });

  it('token revogado é reuso, mesmo que ainda não tenha expirado', () => {
    expect(decideRefresh({ expiresAt: later, revokedAt: earlier }, now)).toBe('reused');
  });

  it('reuso tem precedência sobre expiração', () => {
    expect(decideRefresh({ expiresAt: earlier, revokedAt: earlier }, now)).toBe('reused');
  });
});

describe('refresh token', () => {
  it('é aleatório, em base64url, com 256 bits', () => {
    const token = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(token);
  });

  it('é guardado como SHA-256 em hexadecimal, determinístico', () => {
    expect(hashRefreshToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
