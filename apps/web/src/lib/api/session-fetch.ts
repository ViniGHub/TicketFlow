// Renovação da sessão no navegador (ROADMAP, etapa 6.1; ADR 0016).

/** Rotas de autenticação: um 401 nelas é a resposta, não uma sessão vencida. */
const AUTH_PREFIX = '/api/auth/';
export const REFRESH_PATH = '/api/auth/refresh';

type Fetch = (input: Request) => Promise<Response>;

/**
 * `fetch` que renova a sessão quando o access token venceu: num 401 fora das rotas de
 * autenticação, chama `POST /api/auth/refresh` (o navegador manda o cookie de refresh, que só
 * viaja para `/api/auth`) e repete a chamada uma vez. Várias chamadas que recebem 401 juntas
 * esperam a mesma renovação: o refresh token é rotacionado a cada uso, e duas renovações em
 * paralelo fariam a segunda reutilizar um token já trocado, o que revoga a sessão (ADR 0003).
 * Se a renovação falha, devolve o 401 original para quem chamou decidir.
 */
export function createSessionFetch(baseFetch: Fetch = (input) => globalThis.fetch(input)): Fetch {
  let refreshing: Promise<boolean> | null = null;

  const refresh = (origin: string): Promise<boolean> => {
    refreshing ??= baseFetch(
      new Request(new URL(REFRESH_PATH, origin), { method: 'POST', credentials: 'same-origin' }),
    )
      .then(
        (response) => response.ok,
        () => false,
      )
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  return async (input) => {
    const retry = input.clone();
    const response = await baseFetch(input);
    const url = new URL(input.url);
    if (response.status !== 401 || url.pathname.startsWith(AUTH_PREFIX)) {
      return response;
    }
    return (await refresh(url.origin)) ? baseFetch(retry) : response;
  };
}
