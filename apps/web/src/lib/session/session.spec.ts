import { type AccessTokenClaims } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { apiBaseUrl, apiTargetUrl } from '../server/api-target';

import { readAccessToken } from './access-token';
import { decideAccess, loginUrlFor, safeNextPath } from './route-access';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const inSeconds = (seconds: number) => Math.floor(NOW / 1000) + seconds;

/** JWT de mentira: cabeçalho e payload em base64url, assinatura qualquer. */
function jwt(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.assinatura`;
}

const buyer: AccessTokenClaims = { sub: 'usuario-1', roles: ['BUYER'], exp: inSeconds(600) };
const organizer: AccessTokenClaims = { ...buyer, roles: ['BUYER', 'ORGANIZER'] };

describe('readAccessToken', () => {
  it('lê o papel e a validade do payload, sem conferir a assinatura', () => {
    expect(readAccessToken(jwt(buyer), NOW)).toEqual(buyer);
  });

  it('token vencido conta como sem sessão', () => {
    expect(readAccessToken(jwt({ ...buyer, exp: inSeconds(0) }), NOW)).toBeNull();
  });

  it.each([undefined, '', 'nao-e-jwt', 'a.%%%.c', jwt({ sub: 1 }), jwt('texto')])(
    'token %j malformado conta como sem sessão',
    (token) => {
      expect(readAccessToken(token, NOW)).toBeNull();
    },
  );

  it('papel desconhecido no payload é recusado', () => {
    expect(readAccessToken(jwt({ ...buyer, roles: ['ADMIN'] }), NOW)).toBeNull();
  });
});

describe('decideAccess', () => {
  it('páginas públicas passam sem sessão', () => {
    expect(decideAccess('/', null)).toEqual({ type: 'allow' });
    expect(decideAccess('/contato', null)).toEqual({ type: 'allow' });
  });

  it('a conta exige sessão, de qualquer papel', () => {
    expect(decideAccess('/conta', null)).toEqual({ type: 'login' });
    expect(decideAccess('/conta/pedidos', buyer)).toEqual({ type: 'allow' });
  });

  it('a área do organizador exige o papel ORGANIZER', () => {
    expect(decideAccess('/organizador', null)).toEqual({ type: 'login' });
    expect(decideAccess('/organizador/eventos', buyer)).toEqual({ type: 'forbidden' });
    expect(decideAccess('/organizador/eventos', organizer)).toEqual({ type: 'allow' });
  });

  it('só o prefixo exato protege: /organizadores não é a área do organizador', () => {
    expect(decideAccess('/organizadores', null)).toEqual({ type: 'allow' });
  });
});

describe('destino depois do login', () => {
  it('o login leva a página pedida, com a query', () => {
    expect(loginUrlFor('/conta?aba=pedidos')).toBe('/entrar?next=%2Fconta%3Faba%3Dpedidos');
  });

  it('aceita só caminhos do próprio site', () => {
    expect(safeNextPath('/conta')).toBe('/conta');
    expect(safeNextPath('//outro.site/x')).toBe('/');
    expect(safeNextPath('/\\outro.site')).toBe('/');
    expect(safeNextPath('https://outro.site')).toBe('/');
    expect(safeNextPath(null, '/conta')).toBe('/conta');
  });
});

describe('BFF', () => {
  it('/api/* vai para a API sem o prefixo, com a query', () => {
    expect(apiTargetUrl('/api/auth/login', '?x=1', 'http://api:3000').href).toBe(
      'http://api:3000/auth/login?x=1',
    );
    expect(apiTargetUrl('/api', '', 'http://api:3000').href).toBe('http://api:3000/');
  });

  it('mantém um caminho base do API_URL', () => {
    expect(apiTargetUrl('/api/me', '', 'https://exemplo.test/v1').href).toBe(
      'https://exemplo.test/v1/me',
    );
  });

  it('API_URL vem do ambiente; fora de produção, a API local é o padrão', () => {
    expect(apiBaseUrl({ API_URL: 'http://api:3000/', NODE_ENV: 'production' })).toBe(
      'http://api:3000',
    );
    expect(apiBaseUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
  });

  it('em produção, sem API_URL ou com valor inválido, falha alto', () => {
    expect(() => apiBaseUrl({ NODE_ENV: 'production' })).toThrow(/API_URL ausente/);
    expect(() => apiBaseUrl({ API_URL: 'ftp://x', NODE_ENV: 'production' })).toThrow(/http/);
    expect(() => apiBaseUrl({ API_URL: 'não é url', NODE_ENV: 'production' })).toThrow(/inválida/);
  });
});
