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

  // Catálogo. Recurso de outro organizador também responde 404 (não revela que existe).
  EVENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  TICKET_TYPE_NOT_FOUND: HttpStatus.NOT_FOUND,
  // 409: a operação conflita com o estado atual do recurso.
  EVENT_NOT_EDITABLE: HttpStatus.CONFLICT,
  EVENT_NOT_DELETABLE: HttpStatus.CONFLICT,
  EVENT_WITHOUT_TICKET_TYPES: HttpStatus.CONFLICT,
  TICKET_TYPE_TOTAL_BELOW_SOLD: HttpStatus.CONFLICT,
  // 422: entrada bem formada (passou no zod) que quebra uma regra que depende de outros dados.
  INVALID_SALES_WINDOW: HttpStatus.UNPROCESSABLE_ENTITY,
  EVENT_IN_PAST: HttpStatus.UNPROCESSABLE_ENTITY,

  // Pedidos (ADR 0005). 409: o estado atual do pedido, do evento ou do lote impede a operação.
  INVALID_ORDER_TRANSITION: HttpStatus.CONFLICT,
  INSUFFICIENT_STOCK: HttpStatus.CONFLICT,
  EVENT_NOT_PUBLISHED: HttpStatus.CONFLICT,
  SALES_WINDOW_CLOSED: HttpStatus.CONFLICT,
  // 422: o pedido quebra uma regra (quantidade, total, Idempotency-Key com outro corpo).
  MAX_PER_ORDER_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  ORDER_TOTAL_TOO_LARGE: HttpStatus.UNPROCESSABLE_ENTITY,
  IDEMPOTENCY_CONFLICT: HttpStatus.UNPROCESSABLE_ENTITY,
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
