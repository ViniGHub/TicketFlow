import { describe, expect, it } from 'vitest';

import { FakeDatabase } from './fake-database.test-helper.js';
import { findBuyerOrder } from './find-order.js';
import { OrderNotFoundError } from './order.js';

function setup() {
  const db = new FakeDatabase();
  db.addOrder('pedido-1', { userId: 'comprador-1', status: 'PAID' });
  return db;
}

describe('consulta do pedido pelo comprador', () => {
  it('o dono vê o pedido', async () => {
    const order = await findBuyerOrder(setup(), { orderId: 'pedido-1', userId: 'comprador-1' });
    expect(order).toMatchObject({ id: 'pedido-1', status: 'PAID' });
  });

  it('pedido de outro comprador responde como inexistente', async () => {
    await expect(
      findBuyerOrder(setup(), { orderId: 'pedido-1', userId: 'comprador-2' }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it('pedido inexistente', async () => {
    await expect(
      findBuyerOrder(setup(), { orderId: 'nao-existe', userId: 'comprador-1' }),
    ).rejects.toThrow(OrderNotFoundError);
  });
});
