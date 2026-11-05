import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createOrderRequestSchema,
  idempotencyKeySchema,
  ORDER_LIMITS,
  orderResponseSchema,
} from './orders.js';

const lotA = '0193a4f2-7c1e-7b3d-9a51-3f0c2d8e4b61';
const lotB = '0193a4f2-7c1e-7b3d-9a51-3f0c2d8e4b62';

describe('corpo do POST /orders', () => {
  it('aceita itens de lotes diferentes', () => {
    const body = {
      items: [
        { ticketTypeId: lotA, quantity: 2 },
        { ticketTypeId: lotB, quantity: 1 },
      ],
    };
    expect(createOrderRequestSchema.parse(body)).toEqual(body);
  });

  it('normaliza o id do lote para minúsculas', () => {
    const parsed = createOrderRequestSchema.parse({
      items: [{ ticketTypeId: lotA.toUpperCase(), quantity: 1 }],
    });
    expect(parsed.items[0]?.ticketTypeId).toBe(lotA);
  });

  it('recusa o mesmo lote duas vezes, mesmo com caixa diferente', () => {
    const result = createOrderRequestSchema.safeParse({
      items: [
        { ticketTypeId: lotA, quantity: 1 },
        { ticketTypeId: lotA.toUpperCase(), quantity: 1 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['items']);
  });

  it.each([
    ['sem itens', { items: [] }],
    ['sem o campo items', {}],
    ['quantidade zero', { items: [{ ticketTypeId: lotA, quantity: 0 }] }],
    ['quantidade fracionária', { items: [{ ticketTypeId: lotA, quantity: 1.5 }] }],
    ['quantidade acima de 100', { items: [{ ticketTypeId: lotA, quantity: 101 }] }],
    ['id que não é UUID', { items: [{ ticketTypeId: 'lote-1', quantity: 1 }] }],
  ])('recusa %s', (_case, body) => {
    expect(createOrderRequestSchema.safeParse(body).success).toBe(false);
  });

  it(`recusa mais de ${ORDER_LIMITS.maxItems} lotes`, () => {
    const items = Array.from({ length: ORDER_LIMITS.maxItems + 1 }, (_, index) => ({
      ticketTypeId: `0193a4f2-7c1e-7b3d-9a51-${String(index).padStart(12, '0')}`,
      quantity: 1,
    }));
    expect(createOrderRequestSchema.safeParse({ items }).success).toBe(false);
    expect(createOrderRequestSchema.safeParse({ items: items.slice(1) }).success).toBe(true);
  });
});

describe('header Idempotency-Key', () => {
  it('é opcional', () => {
    expect(idempotencyKeySchema.parse(undefined)).toBeUndefined();
  });

  it('aceita UUID e chaves com até 255 caracteres visíveis', () => {
    expect(idempotencyKeySchema.parse(lotA)).toBe(lotA);
    expect(idempotencyKeySchema.parse('compra:2026-11-05#1')).toBe('compra:2026-11-05#1');
    expect(idempotencyKeySchema.safeParse('k'.repeat(255)).success).toBe(true);
  });

  it.each([
    ['vazia', ''],
    ['com espaço', 'minha chave'],
    ['com acento', 'tentativa-ú'],
    ['com 256 caracteres', 'k'.repeat(256)],
  ])('recusa chave %s', (_case, key) => {
    expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('resposta do pedido', () => {
  it('aceita um pedido pendente', () => {
    const order = {
      id: lotA,
      status: 'PENDING',
      totalCents: 16_000,
      currency: 'BRL',
      expiresAt: '2026-11-05T12:30:00.000Z',
      createdAt: '2026-11-05T12:00:00.000Z',
      items: [{ ticketTypeId: lotB, quantity: 2, unitPriceCents: 8_000 }],
    };
    expect(orderResponseSchema.parse(order)).toEqual(order);
  });
});

describe('OpenAPI', () => {
  it('gera o schema de entrada e o de saída', () => {
    expect(
      z.toJSONSchema(createOrderRequestSchema, { io: 'input', target: 'openapi-3.0' }),
    ).toMatchObject({ type: 'object' });
    expect(
      z.toJSONSchema(orderResponseSchema, { io: 'output', target: 'openapi-3.0' }),
    ).toMatchObject({ type: 'object' });
  });
});
