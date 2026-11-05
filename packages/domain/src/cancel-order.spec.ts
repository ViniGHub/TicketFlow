import { describe, expect, it } from 'vitest';

import { cancelOrder } from './cancel-order.js';
import { FakeDatabase, FakeSessionExpirer } from './fake-database.test-helper.js';
import {
  type Order,
  OrderNotCancellableError,
  OrderNotFoundError,
  OrderPaymentCompletedError,
} from './order.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const owner = 'comprador-1';

function setup(overrides: Partial<Order> = {}) {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: 8 });
  db.addOrder('pedido-1', {
    userId: owner,
    status: 'PENDING',
    items: [{ ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 }],
    ...overrides,
  });
  return { db, expirer: new FakeSessionExpirer() };
}

const cancel = (db: FakeDatabase, expirer: FakeSessionExpirer, userId = owner) =>
  cancelOrder(db, expirer, { orderId: 'pedido-1', userId });

describe('cancelamento de pedido', () => {
  it('o dono cancela um pedido PENDING e o estoque volta', async () => {
    const { db, expirer } = setup();

    const order = await cancel(db, expirer);

    expect(order.status).toBe('CANCELLED');
    expect(db.order('pedido-1')?.status).toBe('CANCELLED');
    expect(db.available(lotA)).toBe(10);
    // Sem sessão no Stripe, não há o que expirar.
    expect(expirer.calls).toEqual([]);
  });

  it('expira a sessão antes de travar o pedido e devolver o estoque', async () => {
    const { db, expirer } = setup({ stripeSessionId: 'cs_test_1' });
    let lockedWhenExpiring: string[] | undefined;
    expirer.onCall = () => {
      lockedWhenExpiring = [...db.locks];
    };

    await cancel(db, expirer);

    expect(expirer.calls).toEqual(['cs_test_1']);
    expect(lockedWhenExpiring).toEqual([]);
    expect(db.locks).toEqual(['pedido-1']);
  });

  it('pedido de outro comprador ou inexistente responde como não encontrado', async () => {
    const { db, expirer } = setup();
    await expect(cancel(db, expirer, 'outro-comprador')).rejects.toThrow(OrderNotFoundError);
    await expect(
      cancelOrder(db, expirer, { orderId: 'nao-existe', userId: owner }),
    ).rejects.toThrow(OrderNotFoundError);
    expect(db.available(lotA)).toBe(8);
  });

  it.each(['PROCESSING', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] as const)(
    'pedido %s não pode ser cancelado',
    async (status) => {
      const { db, expirer } = setup({ status, stripeSessionId: 'cs_test_1' });

      await expect(cancel(db, expirer)).rejects.toThrow(OrderNotCancellableError);
      expect(db.order('pedido-1')?.status).toBe(status);
      expect(db.available(lotA)).toBe(8);
      expect(expirer.calls).toEqual([]);
    },
  );

  it('se a sessão já foi paga, recusa sem devolver o estoque', async () => {
    const { db, expirer } = setup({ stripeSessionId: 'cs_test_1' });
    expirer.results.set('cs_test_1', 'complete');

    await expect(cancel(db, expirer)).rejects.toThrow(OrderPaymentCompletedError);
    expect(db.order('pedido-1')?.status).toBe('PENDING');
    expect(db.available(lotA)).toBe(8);
  });

  it('se a expiração chegou entre a leitura e a trava, recusa sem devolver de novo', async () => {
    const { db, expirer } = setup();
    db.beforeLock = (id) => db.commitElsewhere(id, { status: 'EXPIRED' });

    await expect(cancel(db, expirer)).rejects.toThrow(OrderNotCancellableError);
    expect(db.releases).toEqual([]);
  });
});
