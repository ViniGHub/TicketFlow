import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Lê o header `Idempotency-Key`. Existe porque o `@Headers()` do Nest não aceita pipes, e a
 * chave precisa passar pelo schema de packages/contracts.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<Request>().header(IDEMPOTENCY_HEADER),
);
