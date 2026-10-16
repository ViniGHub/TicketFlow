import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DomainError } from '@ticketflow/domain';
import { describe, expect, it } from 'vitest';

import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReusedError,
} from '../auth/auth.errors';

import { DOMAIN_ERROR_STATUS } from './error-status';
import { toErrorResponse } from './http-exception.filter';
import { RequestValidationError } from './validation';

class UnmappedError extends DomainError {
  readonly code = 'SEM_STATUS';
}

describe('toErrorResponse', () => {
  it.each([
    [new EmailAlreadyRegisteredError(), HttpStatus.CONFLICT],
    [new InvalidCredentialsError(), HttpStatus.UNAUTHORIZED],
    [new InvalidRefreshTokenError(), HttpStatus.UNAUTHORIZED],
    [new RefreshTokenReusedError(), HttpStatus.UNAUTHORIZED],
  ])('mapeia %s para o status do código', (error, status) => {
    expect(toErrorResponse(error, 'req-1')).toEqual({
      statusCode: status,
      code: error.code,
      message: error.message,
      requestId: 'req-1',
    });
  });

  it('todo código mapeado responde 4xx', () => {
    for (const status of Object.values(DOMAIN_ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  it('erro de validação vira 400 com os detalhes', () => {
    const issues = [{ path: 'email', message: 'inválido' }];

    expect(toErrorResponse(new RequestValidationError(issues))).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues,
    });
  });

  it('usa o code próprio de uma HttpException', () => {
    const error = new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origem.' });

    expect(toErrorResponse(error)).toMatchObject({
      statusCode: 403,
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'Origem.',
    });
  });

  it('deriva o code do status quando a HttpException não traz um', () => {
    expect(toErrorResponse(new NotFoundException())).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(toErrorResponse(new HttpException('teapot', 418))).toMatchObject({ code: 'HTTP_418' });
    expect(toErrorResponse(new ServiceUnavailableException())).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('rate limit responde 429 com mensagem em português', () => {
    expect(toErrorResponse(new ThrottlerException())).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitas tentativas. Tente novamente em instantes.',
      requestId: undefined,
    });
  });

  it('erro inesperado vira 500 sem vazar a mensagem interna', () => {
    const body = toErrorResponse(new Error('senha do banco: hunter2'));

    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno.',
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('erro de domínio sem status mapeado vira 500', () => {
    expect(toErrorResponse(new UnmappedError('x'))).toMatchObject({ statusCode: 500 });
  });
});
