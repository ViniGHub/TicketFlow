import { describe, expect, it } from 'vitest';

import { FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';
import { refundOrder, type Refunder } from './refund-order.js';

/** Gateway de mentira: guarda as chamadas e pode falhar. */
function setup(order: Partial<Order> | null = {}) {
  const db = new FakeDatabase();
  if (order) {
    db.addOrder('pedido-1', {
      status: 'REFUND_PENDING',
      stripePaymentIntentId: 'pi_1',
      ...order,
    });
  }
  const calls: { orderId: string; paymentIntentId: string; openTransactions: number }[] = [];
  let failure: Error | undefined;
  const refunder: Refunder = {
    refund: (orderId, paymentIntentId) => {
      calls.push({ orderId, paymentIntentId, openTransactions: db.openTransactions });
      return failure ? Promise.reject(failure) : Promise.resolve();
    },
  };
  return {
    db,
    calls,
    fail: (error: Error) => {
      failure = error;
    },
    run: () => refundOrder(db, refunder, 'pedido-1'),
  };
}

describe('refundOrder', () => {
  it('pede o reembolso do PaymentIntent do pedido, fora de transação', async () => {
    const { run, calls, db } = setup();

    await expect(run()).resolves.toEqual({ status: 'refund-requested' });
    expect(calls).toEqual([{ orderId: 'pedido-1', paymentIntentId: 'pi_1', openTransactions: 0 }]);
    // O pedido só vira REFUNDED com o charge.refunded.
    expect(db.order('pedido-1')?.status).toBe('REFUND_PENDING');
  });

  it('pedido já reembolsado não chama o Stripe', async () => {
    const { run, calls } = setup({ status: 'REFUNDED' });

    await expect(run()).resolves.toEqual({ status: 'skipped', reason: 'already-refunded' });
    expect(calls).toEqual([]);
  });

  it.each(['PAID', 'PENDING', 'EXPIRED'] as const)(
    'pedido %s não está esperando reembolso: não chama o Stripe',
    async (status) => {
      const { run, calls } = setup({ status });

      await expect(run()).resolves.toEqual({ status: 'skipped', reason: 'not-refund-pending' });
      expect(calls).toEqual([]);
    },
  );

  it('pedido inexistente ou sem PaymentIntent não chama o Stripe', async () => {
    const missing = setup(null);
    const free = setup({ stripePaymentIntentId: null });

    await expect(missing.run()).resolves.toEqual({ status: 'skipped', reason: 'order-not-found' });
    await expect(free.run()).resolves.toEqual({ status: 'skipped', reason: 'no-payment-intent' });
    expect([...missing.calls, ...free.calls]).toEqual([]);
  });

  it('erro do Stripe sobe, para o job tentar de novo', async () => {
    const { run, fail } = setup();
    fail(new Error('Stripe fora do ar'));

    await expect(run()).rejects.toThrow('Stripe fora do ar');
  });
});
