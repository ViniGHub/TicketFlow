import { type CookieOptions, type Response } from 'express';

import { type IssuedSession } from './auth.service';
import { ACCESS_COOKIE, ACCESS_TOKEN_TTL_SECONDS, REFRESH_COOKIE } from './session';

export interface SessionCookieOptions {
  /** Caminho do cookie de refresh, como o navegador vê a API (`/auth`, ou `/api/auth` via BFF). */
  refreshPath: string;
}

// httpOnly: inacessível ao JavaScript. Secure: só HTTPS (o navegador aceita em localhost).
// SameSite=Lax: não vai em POST cross-site (ARCHITECTURE.md, seção 10).
const base: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };

export function setSessionCookies(
  response: Response,
  session: Pick<IssuedSession, 'accessToken' | 'refreshToken' | 'refreshExpiresAt'>,
  options: SessionCookieOptions,
): void {
  response.cookie(ACCESS_COOKIE, session.accessToken, {
    ...base,
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  // O refresh token só é enviado às rotas de refresh e logout.
  response.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...base,
    path: options.refreshPath,
    expires: session.refreshExpiresAt,
  });
}

export function clearSessionCookies(response: Response, options: SessionCookieOptions): void {
  response.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  response.clearCookie(REFRESH_COOKIE, { ...base, path: options.refreshPath });
}
