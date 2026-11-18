import createClient from 'openapi-fetch';

import { apiErrorFrom, networkError } from './errors';
import { type paths } from './schema';
import { createSessionFetch } from './session-fetch';

/**
 * Cliente tipado da API, pelo BFF (`/api/*` no próprio site). Os tipos vêm do OpenAPI
 * (`pnpm api:types`): mudar a API sem regerar falha no CI, e regerar com incompatibilidade
 * quebra o typecheck daqui (ADR 0016). Só no navegador: o caminho é relativo à página.
 */
export const api = createClient<paths>({
  baseUrl: '/api',
  credentials: 'same-origin',
  fetch: createSessionFetch(),
});

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Devolve `data` ou lança `ApiError`, para o TanStack Query tratar o erro. Falha de rede (o
 * `fetch` lança) vira `ApiError` com código `NETWORK`.
 */
export async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call;
  } catch {
    throw networkError();
  }
  if (!result.response.ok) {
    throw apiErrorFrom(result.response, result.error);
  }
  return result.data as T;
}
