import { type AccessTokenClaims, accessTokenClaimsSchema } from '@ticketflow/contracts';

// Leitura do access token no proxy (ROADMAP, etapa 6.1; ADR 0016).

/**
 * O payload do JWT, se ele ainda vale. **Não confere a assinatura**: o front não tem o
 * `JWT_SECRET`, e não precisa. O proxy só decide qual página mostrar; quem autoriza é a API, a
 * cada chamada. Um token adulterado mostraria no máximo a casca vazia de uma página protegida.
 */
export function readAccessToken(
  token: string | undefined,
  nowMs: number,
): AccessTokenClaims | null {
  const payload = token?.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = accessTokenClaimsSchema.safeParse(JSON.parse(decodeBase64Url(payload)));
    return claims.success && claims.data.exp * 1000 > nowMs ? claims.data : null;
  } catch {
    // Base64 ou JSON inválido: como se não houvesse sessão.
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
