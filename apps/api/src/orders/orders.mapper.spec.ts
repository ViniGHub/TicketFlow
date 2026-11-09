import { orderResponseSchema } from '@ticketflow/contracts';
import { type OrderRow, toDomainOrder } from '@ticketflow/persistence';
import { describe, expect, it } from 'vitest';

import { toOrderResponse } from './orders.mapper';

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

describe('resposta HTTP do pedido', () => {
  it('é válida para o contrato, com datas em ISO e sem o comprador', () => {
    const response = toOrderResponse(toDomainOrder(row));
    expect(orderResponseSchema.parse(response)).toEqual(response);
    expect(response.expiresAt).toBe('2026-11-20T12:30:00.000Z');
    expect(response).not.toHaveProperty('userId');
  });
});
