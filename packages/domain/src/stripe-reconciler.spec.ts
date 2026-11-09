import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { FAKE_NOW, FakeCheckoutGateway, FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';
import { type CheckoutSessionState } from './ports.js';
import {
  CHECKOUT_SESSION_COMPLETED,
  CHECKOUT_SESSION_EXPIRED,
  StripeEventProcessor,
} from './stripe-event-processor.js';
import {
  paymentEventFromSession,
  RECONCILE_AFTER_MS,
  StripeReconciler,
} from './stripe-reconciler.js';

const lot = '0193a4f2-0000-7000-8000-00000000000a';
const NOW = new Date(FAKE_NOW.getTime() + 30 * 60_000);
const sessionOf = (orderId: string) => FakeCheckoutGateway.sessionIdOf(orderId);

function setup() {
  const db = new FakeDatabase();
  db.addTicketType(lot, { available: 3 });
  const gateway = new FakeCheckoutGateway();
  // A consulta ao Stripe nunca acontece com transação aberta (CLAUDE.md, regra 8).
  const openTransactionsOnRetrieve: number[] = [];
  gateway.onCall = () => openTransactionsOnRetrieve.push(db.openTransactions);
  let next = 0;
  const processor = new StripeEventProcessor(db, { newQrToken: () => `qr-${++next}` });
  const reconciler = new StripeReconciler(db, gateway, processor);

  /** Pedido de 2 ingressos com sessão no Stripe, criado há 20 min. */
  function addOrder(
    id: string,
    session: Partial<CheckoutSessionState> | null,
    overrides: Partial<Order> = {},
  ): Order {
    if (session) {
      gateway.addSession(id, session);
    }
    return db.addOrder(id, {
      stripeSessionId: session ? sessionOf(id) : null,
      totalCents: 16_000,
      items: [{ ticketTypeId: lot, quantity: 2, unitPriceCents: 8_000 }],
      createdAt: new Date(NOW.getTime() - 20 * 60_000),
      expiresAt: new Date(NOW.getTime() + 60_000),
      ...overrides,
    });
  }

  return { db, gateway, reconciler, addOrder, openTransactionsOnRetrieve };
}

const paid = { status: 'complete', paymentStatus: 'paid', paymentIntentId: 'pi_1' } as const;

describe('paymentEventFromSession', () => {
  const base: CheckoutSessionState = {
    id: 'cs_test_1',
    orderId: 'pedido-1',
    status: 'open',
    paymentStatus: 'unpaid',
    paymentIntentId: null,
    url: 'https://checkout.stripe.test/cs_test_1',
  };

  it('sessão aberta não vira evento', () => {
    expect(paymentEventFromSession(base, NOW)).toBeNull();
  });

  it('sessão concluída vira checkout.session.completed, com id estável por estado', () => {
    const session = { ...base, ...paid, url: null };

    expect(paymentEventFromSession(session, NOW)).toEqual({
      id: 'reconcile:cs_test_1:complete:paid',
      type: CHECKOUT_SESSION_COMPLETED,
      createdAt: NOW,
      session,
      charge: null,
    });
    expect(paymentEventFromSession({ ...session, paymentStatus: 'unpaid' }, NOW)?.id).toBe(
      'reconcile:cs_test_1:complete:unpaid',
    );
  });

  it('sessão expirada vira checkout.session.expired', () => {
    const event = paymentEventFromSession({ ...base, status: 'expired', url: null }, NOW);

    expect(event).toMatchObject({
      id: 'reconcile:cs_test_1:expired:unpaid',
      type: CHECKOUT_SESSION_EXPIRED,
    });
  });
});

describe('StripeReconciler.reconcileSession', () => {
  it('aplica o pagamento que o webhook não entregou: PAID, ingressos e e-mail na outbox', async () => {
    const { db, reconciler, addOrder, openTransactionsOnRetrieve } = setup();
    addOrder('pedido-1', paid);

    const result = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(result).toEqual({ status: 'processed', orderId: 'pedido-1', orderStatus: 'PAID' });
    expect(db.order('pedido-1')).toMatchObject({
      status: 'PAID',
      paidAt: NOW,
      stripePaymentIntentId: 'pi_1',
    });
    expect(db.tickets).toHaveLength(2);
    expect(db.outbox).toEqual([{ type: SEND_TICKET_EMAIL_JOB, payload: { orderId: 'pedido-1' } }]);
    expect(db.stripeEvents.get(`reconcile:${sessionOf('pedido-1')}:complete:paid`)).toBe(
      CHECKOUT_SESSION_COMPLETED,
    );
    expect(openTransactionsOnRetrieve).toEqual([0]);
  });

  it('reconciliar o mesmo estado de novo é um evento repetido e não muda nada', async () => {
    const { db, reconciler, addOrder } = setup();
    addOrder('pedido-1', paid);
    await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    const again = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(again).toEqual({ status: 'duplicate' });
    expect(db.tickets).toHaveLength(2);
    expect(db.outbox).toHaveLength(1);
  });

  it('o webhook já tinha aplicado o pagamento: o evento sintético é ignorado', async () => {
    const { db, reconciler, addOrder } = setup();
    addOrder('pedido-1', paid, { status: 'PAID', stripePaymentIntentId: 'pi_1' });

    const result = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(result).toEqual({ status: 'ignored', reason: 'already-paid', orderId: 'pedido-1' });
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([]);
  });

  it('sessão ainda aberta: nada a aplicar, nenhum evento registrado', async () => {
    const { db, reconciler, addOrder } = setup();
    addOrder('pedido-1', {});

    const result = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(result).toEqual({ status: 'still-open' });
    expect(db.order('pedido-1')?.status).toBe('PENDING');
    expect(db.stripeEvents.size).toBe(0);
    expect(db.runs).toBe(0);
  });

  it('Pix pendente leva a PROCESSING, e o Pix aprovado depois leva a PAID', async () => {
    const { db, gateway, reconciler, addOrder } = setup();
    addOrder('pedido-1', { status: 'complete', paymentStatus: 'unpaid', paymentIntentId: 'pi_1' });

    const pending = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);
    expect(pending).toMatchObject({ status: 'processed', orderStatus: 'PROCESSING' });
    // A sessão não muda enquanto o Pix não é pago: a próxima rodada é repetida.
    await expect(reconciler.reconcileSession(sessionOf('pedido-1'), NOW)).resolves.toEqual({
      status: 'duplicate',
    });

    gateway.addSession('pedido-1', paid);
    const approved = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(approved).toMatchObject({ status: 'processed', orderStatus: 'PAID' });
    expect(db.tickets).toHaveLength(2);
  });

  it('sessão expirada sem o aviso do Stripe: o pedido expira e devolve o estoque', async () => {
    const { db, reconciler, addOrder } = setup();
    addOrder('pedido-1', { status: 'expired', url: null });

    const result = await reconciler.reconcileSession(sessionOf('pedido-1'), NOW);

    expect(result).toMatchObject({ status: 'processed', orderStatus: 'EXPIRED' });
    expect(db.available(lot)).toBe(5);
  });

  it('erro do Stripe sobe sem abrir transação', async () => {
    const { db, gateway, reconciler, addOrder } = setup();
    addOrder('pedido-1', paid);
    gateway.retrieveError = new Error('Stripe fora do ar');

    await expect(reconciler.reconcileSession(sessionOf('pedido-1'), NOW)).rejects.toThrow(
      'Stripe fora do ar',
    );
    expect(db.runs).toBe(0);
    expect(db.order('pedido-1')?.status).toBe('PENDING');
  });
});

describe('StripeReconciler.reconcileOrder', () => {
  it('consulta a sessão gravada no pedido e aplica o resultado', async () => {
    const { db, gateway, reconciler, addOrder } = setup();
    addOrder('pedido-1', paid);

    const result = await reconciler.reconcileOrder('pedido-1', NOW);

    expect(result).toMatchObject({ status: 'processed', orderStatus: 'PAID' });
    expect(gateway.retrieved).toEqual([sessionOf('pedido-1')]);
    expect(db.order('pedido-1')?.status).toBe('PAID');
  });

  it('pedido sem sessão ou inexistente: nada a consultar', async () => {
    const { gateway, reconciler, addOrder } = setup();
    addOrder('sem-sessao', null);

    await expect(reconciler.reconcileOrder('sem-sessao', NOW)).resolves.toBeNull();
    await expect(reconciler.reconcileOrder('nao-existe', NOW)).resolves.toBeNull();
    expect(gateway.retrieved).toEqual([]);
  });
});

describe('StripeReconciler.reconcileAwaitingPayment', () => {
  const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

  it('consulta só os pedidos aguardando pagamento com sessão, criados antes do corte', async () => {
    const { gateway, reconciler, addOrder } = setup();
    addOrder('pendente', paid);
    addOrder('processando', paid, { status: 'PROCESSING' });
    addOrder('recente', paid, { createdAt: minutesAgo(5) });
    addOrder('sem-sessao', null);
    addOrder('pago', paid, { status: 'PAID' });
    addOrder('expirado', { status: 'expired' }, { status: 'EXPIRED' });

    const summary = await reconciler.reconcileAwaitingPayment(NOW);

    expect(gateway.retrieved.sort()).toEqual([sessionOf('pendente'), sessionOf('processando')]);
    expect(summary.failed).toEqual([]);
    expect(summary.reconciled.map(({ orderId }) => orderId).sort()).toEqual([
      'pendente',
      'processando',
    ]);
  });

  it('o corte é de 10 min desde a criação do pedido', async () => {
    const { gateway, reconciler, addOrder } = setup();
    addOrder('no-limite', paid, { createdAt: new Date(NOW.getTime() - RECONCILE_AFTER_MS) });
    addOrder('passou', paid, { createdAt: new Date(NOW.getTime() - RECONCILE_AFTER_MS - 1) });

    await reconciler.reconcileAwaitingPayment(NOW);

    expect(gateway.retrieved).toEqual([sessionOf('passou')]);
  });

  it('respeita o lote, os mais antigos primeiro', async () => {
    const { gateway, reconciler, addOrder } = setup();
    addOrder('terceiro', {}, { createdAt: minutesAgo(15) });
    addOrder('primeiro', {}, { createdAt: minutesAgo(40) });
    addOrder('segundo', {}, { createdAt: minutesAgo(25) });

    const summary = await reconciler.reconcileAwaitingPayment(NOW, 2);

    expect(gateway.retrieved).toEqual([sessionOf('primeiro'), sessionOf('segundo')]);
    expect(summary.reconciled).toEqual([
      { orderId: 'primeiro', result: { status: 'still-open' } },
      { orderId: 'segundo', result: { status: 'still-open' } },
    ]);
  });

  it('a falha de um pedido não impede os outros', async () => {
    const { db, gateway, reconciler, addOrder } = setup();
    addOrder('quebrado', paid, { createdAt: minutesAgo(40) });
    addOrder('ok', paid, { createdAt: minutesAgo(30) });
    gateway.sessions.delete(sessionOf('quebrado'));

    const summary = await reconciler.reconcileAwaitingPayment(NOW);

    expect(summary.failed.map(({ orderId }) => orderId)).toEqual(['quebrado']);
    expect(summary.failed[0]?.error).toBeInstanceOf(Error);
    expect(summary.reconciled).toEqual([
      { orderId: 'ok', result: { status: 'processed', orderId: 'ok', orderStatus: 'PAID' } },
    ]);
    expect(db.order('ok')?.status).toBe('PAID');
  });
});
