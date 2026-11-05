import { registerRequestSchema } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  openApiSchema,
  RequestValidationError,
  uuidParamPipe,
  ZodValidationPipe,
} from './validation';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(registerRequestSchema);

  it('devolve o valor já transformado pelo schema', () => {
    expect(
      pipe.transform({ email: ' Ana@Exemplo.com ', password: 'uma-senha-forte', name: 'Ana' }),
    ).toEqual({
      email: 'ana@exemplo.com',
      password: 'uma-senha-forte',
      name: 'Ana',
      roles: ['BUYER'],
    });
  });

  it('lança RequestValidationError com o caminho e a mensagem em português', () => {
    let caught: unknown;
    try {
      pipe.transform({ email: 'ana@exemplo.com', password: 'curta', name: 'Ana' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RequestValidationError);
    const [issue] = (caught as RequestValidationError).issues;
    expect(issue?.path).toBe('password');
    expect(issue?.message).toMatch(/8/);
    expect(issue?.message).not.toMatch(/Too small/);
  });

  it('num parâmetro de rota, o caminho do erro é o nome do parâmetro', () => {
    expect(() => uuidParamPipe.transform('123', { type: 'param', data: 'id' })).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ path: 'id' })] }),
    );
    const id = '019a0000-0000-7000-8000-000000000001';
    expect(uuidParamPipe.transform(id, { type: 'param', data: 'id' })).toBe(id);
  });

  it('usa o caminho informado no construtor, como o nome de um header', () => {
    const headerPipe = new ZodValidationPipe(z.string().min(1), 'Idempotency-Key');
    expect(() => headerPipe.transform('', { type: 'custom' })).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ path: 'Idempotency-Key' })] }),
    );
  });
});

describe('openApiSchema', () => {
  it('gera o schema de entrada com formato e valores padrão', () => {
    expect(openApiSchema(registerRequestSchema)).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['email', 'password', 'name']) as unknown,
      properties: {
        email: { type: 'string', format: 'email' },
        roles: { default: ['BUYER'] },
      },
    });
  });
});
