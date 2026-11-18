// Destino do BFF (ARCHITECTURE.md, seção 10; ADR 0016): /api/* vai para a API.

/** Prefixo das rotas da API no site do front. */
export const API_PREFIX = '/api';

const DEV_API_URL = 'http://localhost:3000';

/**
 * O `API_URL` (no compose, `http://api:3000`), lido a cada requisição e não no build: a mesma
 * imagem Docker roda em qualquer ambiente. Sem ele, só fora de produção, vale a API local.
 */
export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.API_URL ?? (env.NODE_ENV === 'production' ? undefined : DEV_API_URL);
  if (!value) {
    throw new Error('API_URL ausente: defina o endereço da API para o front.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`API_URL inválida: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`API_URL precisa ser http ou https: ${value}`);
  }
  return value.replace(/\/+$/, '');
}

/** `/api/auth/login?x=1` vira `<API_URL>/auth/login?x=1`. */
export function apiTargetUrl(pathname: string, search: string, base: string): URL {
  const rest = pathname.slice(API_PREFIX.length) || '/';
  return new URL(`${base}${rest}${search}`);
}
