import { HttpStatus } from '@nestjs/common';

/**
 * Status HTTP de cada erro de domínio, pelo `code` (CLAUDE.md, regra 12). Um código ausente
 * daqui vira 500 e gera log de erro: todo erro de domínio novo precisa entrar nesta tabela.
 */
export const DOMAIN_ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  EMAIL_ALREADY_REGISTERED: HttpStatus.CONFLICT,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_REFRESH_TOKEN: HttpStatus.UNAUTHORIZED,
  REFRESH_TOKEN_REUSED: HttpStatus.UNAUTHORIZED,
};

/** Código usado quando uma HttpException não informa um `code` próprio. */
export const DEFAULT_HTTP_CODES: Readonly<Partial<Record<number, string>>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};
