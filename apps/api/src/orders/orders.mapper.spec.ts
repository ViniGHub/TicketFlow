import { orderResponseSchema } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { type OrderRow, toDomainOrder, toOrderResponse } from './orders.mapper';

const row: OrderRow = {
  id: '0193a4f2-0000-7000-8000-000000000001',
  userId: '0193a4f2-0000-7000-8000-000000000002',
  status: 'PENDING',
  totalCents: 20_000,
  currency: 'BRL',
  idempotencyKey: 'tentativa-1',
  requestHash: 'abc',
  stripeSessionId: null,
  stripePaymentIntentId: null,
  expiresAt: new Date('2026-11-20T12:30:00Z'),
  paidAt: null,
  createdAt: new Date('2026-11-20T12:00:00Z'),
  updatedAt: new Date('2026-11-20T12:00:00Z'),
  items: [
    {
      id: '0193a4f2-0000-7000-8000-000000000003',
      orderId: '0193a4f2-0000-7000-8000-000000000001',
      ticketTypeId: '0193a4f2-0000-7000-8000-00000000000a',
      quantity: 2,
      unitPriceCents: 10_000,
    },
  ],
};

describe('mapper de pedidos', () => {
  it('converte a linha do banco no pedido do domínio, sem campos de infraestrutura', () => {
    const order = toDomainOrder(row);
    expect(order).toMatchObject({
      id: row.id,
      status: 'PENDING',
      currency: 'BRL',
      totalCents: 20_000,
    });
    expect(order.items).toEqual([
      { ticketTypeId: '0193a4f2-0000-7000-8000-00000000000a', quantity: 2, unitPriceCents: 10_000 },
    ]);
    expect(order).not.toHaveProperty('updatedAt');
  });

  it('recusa moeda diferente de BRL', () => {
    expect(() => toDomainOrder({ ...row, currency: 'USD' })).toThrow(/Moeda inesperada/);
  });

  it('gera uma resposta válida para o contrato, com datas em ISO', () => {
    const response = toOrderResponse(toDomainOrder(row));
    expect(orderResponseSchema.parse(response)).toEqual(response);
    expect(response.expiresAt).toBe('2026-11-20T12:30:00.000Z');
    expect(response).not.toHaveProperty('userId');
  });
});
