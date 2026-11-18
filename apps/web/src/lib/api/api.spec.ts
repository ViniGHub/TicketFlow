import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiErrorFrom, isRetryable, messageFor, networkError } from './errors';
import { createSessionFetch, REFRESH_PATH } from './session-fetch';

const ORIGIN = 'http://localhost:3001';
const request = (path: string, init?: RequestInit) => new Request(`${ORIGIN}${path}`, init);
const status = (code: number) => new Response(null, { status: code });

/** `fetch` de mentira: responde pela rota, na ordem das respostas configuradas. */
function fakeFetch(routes: Record<string, number[]>) {
  const calls: string[] = [];
  const fetch = vi.fn((input: Request) => {
    const path = new URL(input.url).pathname;
    calls.push(`${input.method} ${path}`);
    const next = routes[path]?.shift() ?? 500;
    return Promise.resolve(status(next));
  });
  return { fetch, calls };
}

describe('createSessionFetch', () => {
  it('401: renova a sessão e repete a chamada uma vez', async () => {
    const { fetch, calls } = fakeFetch({ '/api/me': [401, 200], [REFRESH_PATH]: [200] });

    const response = await createSessionFetch(fetch)(request('/api/me'));

    expect(response.status).toBe(200);
    expect(calls).toEqual(['GET /api/me', `POST ${REFRESH_PATH}`, 'GET /api/me']);
  });

  it('repete com o mesmo corpo da chamada original', async () => {
    const bodies: string[] = [];
    let first = true;
    const fetch = async (input: Request) => {
      if (new URL(input.url).pathname === REFRESH_PATH) {
        return status(200);
      }
      bodies.push(await input.text());
      const code = first ? 401 : 201;
      first = false;
      return status(code);
    };

    await createSessionFetch(fetch)(
      request('/api/orders', { method: 'POST', body: JSON.stringify({ itens: 1 }) }),
    );

    expect(bodies).toEqual(['{"itens":1}', '{"itens":1}']);
  });

  it('chamadas com 401 ao mesmo tempo esperam uma renovação só', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/me': [401, 200],
      '/api/me/tickets': [401, 200],
      [REFRESH_PATH]: [200],
    });
    const sessionFetch = createSessionFetch(fetch);

    await Promise.all([sessionFetch(request('/api/me')), sessionFetch(request('/api/me/tickets'))]);

    expect(calls.filter((call) => call.endsWith(REFRESH_PATH))).toHaveLength(1);
  });

  it('renovação recusada: devolve o 401 original, sem repetir', async () => {
    const { fetch, calls } = fakeFetch({ '/api/me': [401], [REFRESH_PATH]: [401] });

    const response = await createSessionFetch(fetch)(request('/api/me'));

    expect(response.status).toBe(401);
    expect(calls).toEqual(['GET /api/me', `POST ${REFRESH_PATH}`]);
  });

  it('401 nas rotas de autenticação é a resposta: senha errada não tenta renovar', async () => {
    const { fetch, calls } = fakeFetch({ '/api/auth/login': [401] });

    const response = await createSessionFetch(fetch)(
      request('/api/auth/login', { method: 'POST' }),
    );

    expect(response.status).toBe(401);
    expect(calls).toEqual(['POST /api/auth/login']);
  });

  it('outros status passam direto', async () => {
    const { fetch, calls } = fakeFetch({ '/api/me': [403] });

    expect((await createSessionFetch(fetch)(request('/api/me'))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });
});

describe('erros da API', () => {
  it('lê o código, a mensagem e os campos do corpo de erro', () => {
    const error = apiErrorFrom(status(400), {
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Corpo inválido.',
      issues: [{ path: 'email', message: 'E-mail inválido' }],
    });

    expect(error).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    expect(error.issues).toEqual([{ path: 'email', message: 'E-mail inválido' }]);
  });

  it('corpo fora do formato vira HTTP_<status>', () => {
    expect(apiErrorFrom(status(404), '<html>')).toMatchObject({ code: 'HTTP_404' });
  });

  it('5xx sem o corpo da API é a API fora do ar: serviço indisponível', () => {
    const error = apiErrorFrom(status(500), '<html>');

    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(messageFor(error)).toMatch(/indisponível/);
  });

  it('mensagens em português, com uma genérica para o código desconhecido', () => {
    expect(messageFor(new ApiError(401, 'INVALID_CREDENTIALS', ''))).toBe(
      'E-mail ou senha incorretos.',
    );
    expect(messageFor(networkError())).toMatch(/conexão/);
    expect(messageFor(new ApiError(409, 'QUALQUER_OUTRO', ''))).toBe(
      'Algo deu errado. Tente de novo.',
    );
    expect(messageFor(new Error('x'))).toBe('Algo deu errado. Tente de novo.');
  });

  it('código sem mensagem própria: a mensagem em português que a API mandou, se for 4xx', () => {
    const refused = apiErrorFrom(status(409), {
      statusCode: 409,
      code: 'EVENT_WITHOUT_TICKET_TYPES',
      message: 'Cadastre ao menos um lote antes de publicar o evento.',
    });
    const crashed = apiErrorFrom(status(500), {
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Erro interno.',
    });

    expect(messageFor(refused)).toBe('Cadastre ao menos um lote antes de publicar o evento.');
    expect(messageFor(crashed)).toBe('Algo deu errado. Tente de novo.');
  });

  it('4xx não se repete; 5xx e falha de rede, sim', () => {
    expect(isRetryable(new ApiError(404, 'X', ''))).toBe(false);
    expect(isRetryable(new ApiError(503, 'X', ''))).toBe(true);
    expect(isRetryable(networkError())).toBe(true);
  });
});
