import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { decodeCursor, encodeCursor, toPage } from './pagination';
import { RequestValidationError } from './validation';

const keySchema = z.object({ id: z.uuid(), startsAt: z.iso.datetime() });
const key = { id: '019a0000-0000-7000-8000-000000000001', startsAt: '2026-12-10T23:00:00.000Z' };

describe('cursor', () => {
  it('ida e volta devolve a mesma chave', () => {
    const cursor = encodeCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, keySchema)).toEqual(key);
  });

  it.each([
    ['base64 que não é JSON', Buffer.from('não é json').toString('base64url')],
    ['JSON com outro formato', encodeCursor({ id: 'não-é-uuid', startsAt: key.startsAt })],
    ['texto qualquer', '%%%'],
  ])('%s responde erro de validação no campo cursor', (_case, cursor) => {
    let caught: unknown;
    try {
      decodeCursor(cursor, keySchema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RequestValidationError);
    expect((caught as RequestValidationError).issues).toEqual([
      { path: 'cursor', message: 'Cursor inválido.' },
    ]);
  });
});

describe('toPage', () => {
  const cursorOf = (row: number) => `depois-de-${row}`;
  const double = (row: number) => row * 2;

  it('com a linha extra, devolve só o limite e o cursor do último item', () => {
    expect(toPage([1, 2, 3], 2, double, cursorOf)).toEqual({
      items: [2, 4],
      nextCursor: 'depois-de-2',
    });
  });

  it('sem a linha extra, é a última página', () => {
    expect(toPage([1, 2], 2, double, cursorOf)).toEqual({ items: [2, 4], nextCursor: null });
    expect(toPage([], 2, double, cursorOf)).toEqual({ items: [], nextCursor: null });
  });
});
