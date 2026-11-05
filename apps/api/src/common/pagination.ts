import { type Page } from '@ticketflow/contracts';
import { type z } from 'zod';

import { RequestValidationError } from './validation';

// Paginação por cursor (keyset): a próxima página continua depois do último item da atual,
// pela mesma chave de ordenação. Não pula nem repete itens quando registros novos entram
// durante a navegação, e não precisa de COUNT(*). ADR 0004.

/** Cursor opaco para o cliente: a chave do último item, em JSON e base64url. */
export function encodeCursor(key: Record<string, string>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/** Lê o cursor recebido. Qualquer cursor malformado ou adulterado responde 400. */
export function decodeCursor<Schema extends z.ZodType>(
  raw: string,
  schema: Schema,
): z.output<Schema> {
  try {
    const key: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const result = schema.safeParse(key);
    if (result.success) {
      return result.data;
    }
  } catch {
    // JSON inválido: mesmo erro do cursor com formato errado.
  }
  throw new RequestValidationError([{ path: 'cursor', message: 'Cursor inválido.' }]);
}

/**
 * Monta a página a partir de `limit + 1` linhas: a linha extra só indica que existe uma
 * próxima página e não é devolvida.
 */
export function toPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => string,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null,
  };
}
