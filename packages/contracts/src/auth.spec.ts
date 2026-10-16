import { describe, expect, it } from 'vitest';

import { loginRequestSchema, registerRequestSchema } from './auth.js';

describe('registerRequestSchema', () => {
  const valid = { email: 'ana@exemplo.com', password: 'uma-senha-forte', name: 'Ana' };

  it('normaliza o e-mail e assume o papel de comprador', () => {
    expect(registerRequestSchema.parse({ ...valid, email: '  Ana@Exemplo.COM ' })).toEqual({
      ...valid,
      roles: ['BUYER'],
    });
  });

  it('aceita os dois papéis', () => {
    const roles = ['BUYER', 'ORGANIZER'];
    expect(registerRequestSchema.parse({ ...valid, roles }).roles).toEqual(roles);
  });

  it.each([
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['senha curta', { password: 'curta' }],
    ['nome vazio', { name: '   ' }],
    ['papel desconhecido', { roles: ['ADMIN'] }],
    ['papéis repetidos', { roles: ['BUYER', 'BUYER'] }],
    ['lista de papéis vazia', { roles: [] }],
  ])('recusa %s', (_case, override) => {
    expect(registerRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('aceita senha curta (a checagem é da autenticação, não da validação)', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });
});
