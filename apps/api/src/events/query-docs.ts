import { type ApiQueryOptions } from '@nestjs/swagger';
import { CATALOG_LIMITS } from '@ticketflow/contracts';

// Parâmetros de query no Swagger (e nos tipos que o front gera do /docs-json, etapa 6.1).
// A validação de verdade é o schema zod da query.

export const cursorQueryDocs: ApiQueryOptions = {
  name: 'cursor',
  required: false,
  description: 'Valor de `nextCursor` da página anterior.',
  schema: { type: 'string' },
};

export const limitQueryDocs: ApiQueryOptions = {
  name: 'limit',
  required: false,
  description: 'Itens por página.',
  schema: {
    type: 'integer',
    minimum: 1,
    maximum: CATALOG_LIMITS.maxPageSize,
    default: CATALOG_LIMITS.defaultPageSize,
  },
};

export function dateTimeQueryDocs(name: string, description: string): ApiQueryOptions {
  return { name, required: false, description, schema: { type: 'string', format: 'date-time' } };
}
