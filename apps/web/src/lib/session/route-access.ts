import { type AccessTokenClaims, type Role } from '@ticketflow/contracts';

// Quais páginas exigem sessão, e com qual papel (ROADMAP, etapa 6.1; ADR 0016).

interface ProtectedRoute {
  prefix: string;
  /** `null`: basta estar logado. */
  role: Role | null;
}

export const PROTECTED_ROUTES: readonly ProtectedRoute[] = [
  { prefix: '/organizador', role: 'ORGANIZER' },
  { prefix: '/conta', role: null },
];

export const LOGIN_PATH = '/entrar';
export const FORBIDDEN_PATH = '/sem-acesso';

export type AccessDecision =
  | { type: 'allow' }
  /** Sem sessão válida: vai para o login, que tenta renovar antes de pedir a senha. */
  | { type: 'login' }
  /** Logado, mas sem o papel que a página exige. */
  | { type: 'forbidden' };

export function protectedRouteOf(pathname: string): ProtectedRoute | null {
  return (
    PROTECTED_ROUTES.find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ?? null
  );
}

export function decideAccess(pathname: string, claims: AccessTokenClaims | null): AccessDecision {
  const route = protectedRouteOf(pathname);
  if (!route) {
    return { type: 'allow' };
  }
  if (!claims) {
    return { type: 'login' };
  }
  if (route.role && !claims.roles.includes(route.role)) {
    return { type: 'forbidden' };
  }
  return { type: 'allow' };
}

/** `/entrar?next=<página>`: depois do login, o comprador volta para onde estava. */
export function loginUrlFor(next: string): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

/**
 * Destino depois do login, só dentro do próprio site: um `next` como `//outro.site` ou
 * `https://...` levaria o usuário para fora (open redirect).
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
