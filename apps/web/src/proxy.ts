import { ACCESS_COOKIE } from '@ticketflow/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { API_PREFIX, apiBaseUrl, apiTargetUrl } from './lib/server/api-target';
import { readAccessToken } from './lib/session/access-token';
import { decideAccess, FORBIDDEN_PATH, loginUrlFor } from './lib/session/route-access';

/**
 * Proxy do Next 16 (o antigo middleware), em Node a cada requisição (ROADMAP, etapa 6.1;
 * ADR 0016):
 *
 * - `/api/*` é reescrito para a API (BFF). O navegador só fala com o site do front, então os
 *   cookies da sessão são first-party (ARCHITECTURE.md, seção 10).
 * - As páginas protegidas exigem uma sessão válida e, na área do organizador, o papel
 *   `ORGANIZER`. Sem sessão, vai para o login, que tenta renovar antes de pedir a senha: o
 *   cookie de refresh só viaja para `/api/auth`, nunca chega aqui.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
    return NextResponse.rewrite(apiTargetUrl(pathname, search, apiBaseUrl()));
  }

  const claims = readAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, Date.now());
  const decision = decideAccess(pathname, claims);
  if (decision.type === 'login') {
    return NextResponse.redirect(new URL(loginUrlFor(`${pathname}${search}`), request.url));
  }
  if (decision.type === 'forbidden') {
    return NextResponse.redirect(new URL(FORBIDDEN_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/conta/:path*', '/organizador/:path*', '/pedidos/:path*'],
};
