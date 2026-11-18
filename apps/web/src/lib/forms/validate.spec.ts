import { loginRequestSchema, registerRequestSchema } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { registerValuesOf, REGISTER_MESSAGES } from '../../app/cadastro/register-form';
import { ApiError } from '../api/errors';

import { fieldErrorsFromApi, validate } from './validate';

const LOGIN_MESSAGES = { email: 'Informe um e-mail válido.', password: 'Informe a senha.' };

describe('validate', () => {
  it('valores válidos voltam normalizados pelo schema da API', () => {
    const result = validate(
      loginRequestSchema,
      { email: ' Ana@Exemplo.com ', password: 'x' },
      LOGIN_MESSAGES,
    );

    expect(result).toEqual({ ok: true, data: { email: 'ana@exemplo.com', password: 'x' } });
  });

  it('cada campo inválido recebe a mensagem em português do formulário', () => {
    const result = validate(
      loginRequestSchema,
      { email: 'sem-arroba', password: '' },
      LOGIN_MESSAGES,
    );

    expect(result).toEqual({ ok: false, errors: LOGIN_MESSAGES });
  });

  it('cadastro: senha curta e nome vazio, com o e-mail certo', () => {
    const form = new FormData();
    form.set('name', ' ');
    form.set('email', 'ana@exemplo.com');
    form.set('password', 'curta');

    const result = validate(registerRequestSchema, registerValuesOf(form), {
      ...REGISTER_MESSAGES,
      roles: '',
    });

    expect(result).toEqual({
      ok: false,
      errors: { name: REGISTER_MESSAGES.name, password: REGISTER_MESSAGES.password },
    });
  });

  it('marcar "organizar eventos" pede os dois papéis', () => {
    const form = new FormData();
    form.set('organizer', 'on');

    expect(registerValuesOf(form).roles).toEqual(['BUYER', 'ORGANIZER']);
    expect(registerValuesOf(new FormData()).roles).toEqual(['BUYER']);
  });
});

describe('fieldErrorsFromApi', () => {
  it('o 400 da API marca os mesmos campos do formulário', () => {
    const error = new ApiError(400, 'BAD_REQUEST', 'Corpo inválido.', [
      { path: 'email', message: 'Invalid email' },
      { path: 'outro', message: 'x' },
    ]);

    expect(fieldErrorsFromApi(error, LOGIN_MESSAGES)).toEqual({ email: LOGIN_MESSAGES.email });
  });

  it('outros erros não marcam campo nenhum', () => {
    expect(
      fieldErrorsFromApi(new ApiError(409, 'EMAIL_ALREADY_REGISTERED', ''), LOGIN_MESSAGES),
    ).toEqual({});
  });
});
