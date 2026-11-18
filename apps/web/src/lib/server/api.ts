import createClient from 'openapi-fetch';

import { type paths } from '../api/schema';

import { apiBaseUrl } from './api-target';

/**
 * Cliente da API para Server Components (ROADMAP, etapa 6.2; ADR 0017): fala direto com o
 * `API_URL`, sem passar pelo BFF, e sem cache, porque o estoque muda a cada compra. Só para
 * rotas públicas: não repassa os cookies de quem está navegando.
 */
export function serverApi() {
  return createClient<paths>({ baseUrl: apiBaseUrl(), cache: 'no-store' });
}
