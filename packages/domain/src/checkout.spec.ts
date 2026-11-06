import { describe, expect, it } from 'vitest';

import { CheckoutUnavailableError, startCheckout } from './checkout.js';
import { FAKE_NOW, FakeCheckoutGateway, FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';
const orderId = 'pedido-1';
const sessionId = FakeCheckoutGateway.sessionIdOf(orderId);
const expiresAt = new Date(FAKE_NOW.getTime() + 30 * 60_000);

function setup(overrides: Partial<Order> = {}) {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: 8, name: 'Pista' });
  db.addTicketType(lotB, { available: 4, name: 'Meia' });
  const order = db.addOrder(orderId, {
    status: 'PENDING',
    totalCents: 20_000,
    items: [
      { ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 },
      { ticketTypeId: lotB, quantity: 1, unitPriceCents: 4_000 },
    ],
    expiresAt,
    ...overrides,
  });
  const gateway = new FakeCheckoutGateway();
  // Nenhuma chamada ao Stripe com transação aberta (CLAUDE.md, regra 8).
  const transactionsAtCall: number[] = [];
  gateway.onCall = () => transactionsAtCall.push(db.openTransactions);
  return { db, gateway, order, transactionsAtCall };
}

describe('abertura do pagamento', () => {
  it('cria a sessão com os itens do pedido, fora de transação, e grava o id', async () => {
    const { db, gateway, order, transactionsAtCall } = setup();

    const result = await startCheckout(db, gateway, order);

    expect(gateway.created).toEqual([
      {
        orderId,
        lineItems: [
          { name: 'Show de Teste – Pista', quantity: 2, unitPriceCents: 8_000 },
          { name: 'Show de Teste – Meia', quantity: 1, unitPriceCents: 4_000 },
        ],
        expiresAt,
        orderCreatedAt: FAKE_NOW,
      },
    ]);
    expect(transactionsAtCall).toEqual([0]);
    expect(db.order(orderId)?.stripeSessionId).toBe(sessionId);
    expect(result.order).toMatchObject({ status: 'PENDING', stripeSessionId: sessionId });
    expect(result.checkoutUrl).toBe(`https://checkout.stripe.test/${sessionId}`);
  });

  it('falha do gateway: o pedido é cancelado e o estoque volta', async () => {
    const { db, gateway, order } = setup();
    const stripeError = new Error('Stripe fora do ar');
    gateway.createError = stripeError;

    const attempt = startCheckout(db, gateway, order);

    await expect(attempt).rejects.toThrow(CheckoutUnavailableError);
    await expect(attempt).rejects.toMatchObject({
      code: 'CHECKOUT_UNAVAILABLE',
      cause: stripeError,
    });
    expect(db.order(orderId)?.status).toBe('CANCELLED');
    expect(db.available(lotA)).toBe(10);
    expect(db.available(lotB)).toBe(5);
  });

  it('falha do gateway depois de outra requisição gravar a sessão: não cancela', async () => {
    const { db, gateway, order } = setup();
    gateway.createError = new Error('timeout');
    gateway.onCall = () => db.commitElsewhere(orderId, { stripeSessionId: sessionId });

    await expect(startCheckout(db, gateway, order)).rejects.toThrow(CheckoutUnavailableError);
    expect(db.order(orderId)?.status).toBe('PENDING');
    expect(db.releases).toEqual([]);
  });

  it('falha do gateway com o pedido já cancelado por outra transação: não devolve de novo', async () => {
    const { db, gateway, order } = setup();
    gateway.createError = new Error('timeout');
    gateway.onCall = () => db.commitElsewhere(orderId, { status: 'EXPIRED' });

    await expect(startCheckout(db, gateway, order)).rejects.toThrow(CheckoutUnavailableError);
    expect(db.order(orderId)?.status).toBe('EXPIRED');
    expect(db.releases).toEqual([]);
  });

  it('pedido cancelado enquanto a sessão era criada: expira a sessão e não a grava', async () => {
    const { db, gateway, order, transactionsAtCall } = setup();
    gateway.onCall = (method) => {
      transactionsAtCall.push(db.openTransactions);
      if (method === 'create') {
        db.commitElsewhere(orderId, { status: 'CANCELLED' });
      }
    };

    const result = await startCheckout(db, gateway, order);

    expect(gateway.expired).toEqual([sessionId]);
    expect(transactionsAtCall).toEqual([0, 0]);
    expect(db.order(orderId)?.stripeSessionId).toBeNull();
    expect(result).toEqual({
      order: expect.objectContaining({ status: 'CANCELLED' }) as Order,
      checkoutUrl: null,
    });
  });

  it('falha ao expirar a sessão de um pedido que já foi cancelado', async () => {
    const { db, gateway, order } = setup();
    gateway.expireError = new Error('Stripe fora do ar');
    gateway.onCall = (method) => {
      if (method === 'create') {
        db.commitElsewhere(orderId, { status: 'CANCELLED' });
      }
    };

    await expect(startCheckout(db, gateway, order)).rejects.toThrow(CheckoutUnavailableError);
    expect(db.order(orderId)?.stripeSessionId).toBeNull();
  });

  it('outra requisição gravou a mesma sessão antes: devolve a URL dela', async () => {
    const { db, gateway, order } = setup();
    gateway.onCall = () => db.commitElsewhere(orderId, { stripeSessionId: sessionId });

    const result = await startCheckout(db, gateway, order);

    expect(gateway.expired).toEqual([]);
    expect(result.checkoutUrl).toBe(`https://checkout.stripe.test/${sessionId}`);
  });

  it('outra sessão foi gravada antes: expira a nova e devolve a URL da gravada', async () => {
    const { db, gateway, order } = setup();
    const other = gateway.addSession('outro', { url: 'https://checkout.stripe.test/outra' });
    gateway.onCall = (method) => {
      if (method === 'create') {
        db.commitElsewhere(orderId, { stripeSessionId: other.id });
      }
    };

    const result = await startCheckout(db, gateway, order);

    expect(gateway.expired).toEqual([sessionId]);
    expect(db.order(orderId)?.stripeSessionId).toBe(other.id);
    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/outra');
  });

  it('retentativa de pedido PENDING sem sessão manda o mesmo pedido e recebe a mesma sessão', async () => {
    const { db, gateway, order } = setup();
    // O processo cai depois de o Stripe criar a sessão e antes de gravá-la.
    db.beforeLock = () => {
      throw new Error('conexão perdida');
    };
    await expect(startCheckout(db, gateway, order)).rejects.toThrow('conexão perdida');
    expect(db.order(orderId)?.stripeSessionId).toBeNull();

    const retry = await startCheckout(db, gateway, order);

    expect(gateway.created).toHaveLength(2);
    expect(gateway.created[1]).toEqual(gateway.created[0]);
    expect(gateway.sessions.size).toBe(1);
    expect(db.order(orderId)?.stripeSessionId).toBe(sessionId);
    expect(retry.checkoutUrl).toBe(`https://checkout.stripe.test/${sessionId}`);
  });
});

describe('pedido que já tem sessão (replay da Idempotency-Key)', () => {
  it('devolve a URL da sessão aberta, sem criar outra', async () => {
    const { db, gateway, order } = setup({ stripeSessionId: sessionId });
    gateway.addSession(orderId);

    const result = await startCheckout(db, gateway, order);

    expect(gateway.created).toEqual([]);
    expect(gateway.retrieved).toEqual([sessionId]);
    expect(result.checkoutUrl).toBe(`https://checkout.stripe.test/${sessionId}`);
  });

  it.each(['complete', 'expired'] as const)('sessão %s: checkoutUrl nulo', async (status) => {
    const { db, gateway, order } = setup({ stripeSessionId: sessionId });
    gateway.addSession(orderId, { status, url: null });

    const result = await startCheckout(db, gateway, order);

    expect(result.checkoutUrl).toBeNull();
    expect(result.order.status).toBe('PENDING');
  });

  it('falha ao consultar a sessão: não cancela o pedido', async () => {
    const { db, gateway, order } = setup({ stripeSessionId: sessionId });
    gateway.retrieveError = new Error('Stripe fora do ar');

    await expect(startCheckout(db, gateway, order)).rejects.toThrow(CheckoutUnavailableError);
    expect(db.order(orderId)?.status).toBe('PENDING');
    expect(db.releases).toEqual([]);
  });

  it.each(['PROCESSING', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] as const)(
    'pedido %s: nem consulta o Stripe',
    async (status) => {
      const { db, gateway, order } = setup({ status, stripeSessionId: sessionId });

      const result = await startCheckout(db, gateway, order);

      expect(result).toEqual({ order, checkoutUrl: null });
      expect(gateway.created).toEqual([]);
      expect(gateway.retrieved).toEqual([]);
    },
  );
});
