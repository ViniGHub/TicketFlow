import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ErrorResponse } from '@ticketflow/contracts';
import { DomainError } from '@ticketflow/domain';
import { type Request, type Response } from 'express';

import { DEFAULT_HTTP_CODES, DOMAIN_ERROR_STATUS } from './error-status';
import { RequestValidationError } from './validation';

const TOO_MANY_REQUESTS: number = HttpStatus.TOO_MANY_REQUESTS;
const TOO_MANY_REQUESTS_MESSAGE = 'Muitas tentativas. Tente novamente em instantes.';

function messageOf(response: string | object, fallback: string): string {
  if (typeof response === 'string') {
    return response;
  }
  const { message } = response as { message?: unknown };
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  return fallback;
}

/** Converte qualquer exceção no formato de erro da API (`ErrorResponse`). */
export function toErrorResponse(exception: unknown, requestId?: string): ErrorResponse {
  if (exception instanceof RequestValidationError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      message: exception.message,
      requestId,
      issues: exception.issues,
    };
  }

  if (exception instanceof DomainError) {
    const statusCode = DOMAIN_ERROR_STATUS[exception.code];
    if (statusCode !== undefined) {
      return { statusCode, code: exception.code, message: exception.message, requestId };
    }
  } else if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const ownCode =
      typeof response === 'object' ? (response as { code?: unknown }).code : undefined;
    return {
      statusCode,
      code:
        typeof ownCode === 'string'
          ? ownCode
          : (DEFAULT_HTTP_CODES[statusCode] ?? `HTTP_${statusCode}`),
      message:
        statusCode === TOO_MANY_REQUESTS
          ? TOO_MANY_REQUESTS_MESSAGE
          : messageOf(response, exception.message),
      requestId,
    };
  }

  // Erro inesperado ou erro de domínio sem status mapeado: nenhum detalhe interno vaza.
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Erro interno.',
    requestId,
  };
}

/** Filtro global: toda resposta de erro sai no mesmo formato, com o request id. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const body = toErrorResponse(exception, requestId);
    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId }, 'Erro não tratado');
    }

    response.status(body.statusCode).json(body);
  }
}
