import { loginRequestSchema, registerRequestSchema } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { registerValuesOf, REGISTER_MESSAGES } from '../../app/cadastro/register-form';
import { ApiError } from '../api/errors';

import { firstInvalid, withoutField } from './use-form-errors';
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

describe('erros na tela', () => {
  const fields = ['title', 'venue', 'startsAt'] as const;

  it('o foco vai para o primeiro campo com erro, na ordem da tela', () => {
    expect(firstInvalid(fields, { startsAt: 'x', venue: 'y' })).toBe('venue');
    expect(firstInvalid(fields, {})).toBeUndefined();
  });

  it('editar um campo tira só o erro dele', () => {
    expect(withoutField({ title: 'a', venue: 'b' }, 'title')).toEqual({ venue: 'b' });
    expect(withoutField({ venue: 'b' }, 'title')).toEqual({ venue: 'b' });
  });
});

describe('fieldErrorsFromApi com erros de domínio', () => {
  const messages = { startsAt: 'Informe a data.', title: 'Informe o título.' };
  const inPast = new ApiError(
    422,
    'EVENT_IN_PAST',
    'A data do evento precisa estar no futuro.',
    [],
    true,
  );

  it('o código ligado a um campo mostra a mensagem da API nele', () => {
    expect(fieldErrorsFromApi(inPast, messages, { EVENT_IN_PAST: 'startsAt' })).toEqual({
      startsAt: 'A data do evento precisa estar no futuro.',
    });
  });

  it('código sem campo não marca campo nenhum', () => {
    expect(fieldErrorsFromApi(inPast, messages)).toEqual({});
  });
});
