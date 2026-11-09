import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';
import { type CheckoutSessionState, type PaymentEvent } from './ports.js';
import {
  CHECKOUT_SESSION_COMPLETED,
  CHECKOUT_SESSION_EXPIRED,
  StripeEventProcessor,
  UnexpectedPaymentError,
} from './stripe-event-processor.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';
const ORDER_ID = 'pedido-1';
const SESSION_ID = 'cs_test_pedido-1';
const EVENT_CREATED_AT = new Date('2026-11-20T12:05:00Z');

/** Pedido de 2 ingressos do lote A e 1 do B, com a sessão gravada e o estoque já descontado. */
function setup(overrides: Partial<Order> = {}) {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: 0 });
  db.addTicketType(lotB, { available: 5 });
  db.addOrder(ORDER_ID, {
    status: 'PENDING',
    stripeSessionId: SESSION_ID,
    totalCents: 21_000,
    items: [
      { ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 },
      { ticketTypeId: lotB, quantity: 1, unitPriceCents: 5_000 },
    ],
    ...overrides,
  });
  let next = 0;
  const processor = new StripeEventProcessor(db, { newQrToken: () => `qr-${++next}` });
  return { db, processor };
}

function sessionEvent(
  type: string,
  session: Partial<CheckoutSessionState> = {},
  id = 'evt_1',
): PaymentEvent {
  return {
    id,
    type,
    createdAt: EVENT_CREATED_AT,
    session: {
      id: SESSION_ID,
      orderId: ORDER_ID,
      status: type === CHECKOUT_SESSION_EXPIRED ? 'expired' : 'complete',
      paymentStatus: type === CHECKOUT_SESSION_EXPIRED ? 'unpaid' : 'paid',
      paymentIntentId: type === CHECKOUT_SESSION_EXPIRED ? null : 'pi_1',
      url: null,
      ...session,
    },
  };
}

const paid = (id = 'evt_1') => sessionEvent(CHECKOUT_SESSION_COMPLETED, {}, id);
const expired = (id = 'evt_1') => sessionEvent(CHECKOUT_SESSION_EXPIRED, {}, id);

describe('checkout.session.completed', () => {
  it('marca o pedido como pago, emite um ingresso por unidade e grava o e-mail na outbox', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process(paid());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'PAID' });
    expect(db.order(ORDER_ID)).toMatchObject({
      status: 'PAID',
      paidAt: EVENT_CREATED_AT,
      stripePaymentIntentId: 'pi_1',
    });
    expect(db.tickets).toEqual([
      { orderId: ORDER_ID, ticketTypeId: lotA, qrToken: 'qr-1' },
      { orderId: ORDER_ID, ticketTypeId: lotA, qrToken: 'qr-2' },
      { orderId: ORDER_ID, ticketTypeId: lotB, qrToken: 'qr-3' },
    ]);
    expect(db.outbox).toEqual([{ type: SEND_TICKET_EMAIL_JOB, payload: { orderId: ORDER_ID } }]);
    expect(db.stripeEvents).toEqual(new Map([['evt_1', CHECKOUT_SESSION_COMPLETED]]));
  });

  it('trava o pedido numa única transação, sem mexer no estoque', async () => {
    const { db, processor } = setup();

    await processor.process(paid());

    expect(db.runs).toBe(1);
    expect(db.locks).toEqual([ORDER_ID]);
    expect(db.reservations).toEqual([]);
    expect(db.releases).toEqual([]);
  });

  it('pedido grátis (sem cobrança) também vira PAID, sem PaymentIntent', async () => {
    const { db, processor } = setup({ totalCents: 0 });

    await processor.process(
      sessionEvent(CHECKOUT_SESSION_COMPLETED, {
        paymentStatus: 'no_payment_required',
        paymentIntentId: null,
      }),
    );

    expect(db.order(ORDER_ID)).toMatchObject({ status: 'PAID', stripePaymentIntentId: null });
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toHaveLength(1);
  });

  it('o mesmo evento duas vezes é processado uma vez só', async () => {
    const { db, processor } = setup();

    await processor.process(paid());
    const second = await processor.process(paid());

    expect(second).toEqual({ status: 'duplicate' });
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toHaveLength(1);
  });

  it('outro evento para o pedido já pago não emite ingressos de novo', async () => {
    const { db, processor } = setup();

    await processor.process(paid('evt_1'));
    const outcome = await processor.process(paid('evt_2'));

    expect(outcome).toEqual({ status: 'ignored', reason: 'already-paid', orderId: ORDER_ID });
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toHaveLength(1);
    expect([...db.stripeEvents.keys()]).toEqual(['evt_1', 'evt_2']);
  });

  it('sessão concluída sem pagamento confirmado (Pix) fica para a etapa 4.3', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process(
      sessionEvent(CHECKOUT_SESSION_COMPLETED, { paymentStatus: 'unpaid', paymentIntentId: null }),
    );

    expect(outcome).toEqual({ status: 'ignored', reason: 'payment-pending', orderId: ORDER_ID });
    expect(db.order(ORDER_ID)?.status).toBe('PENDING');
    expect(db.tickets).toEqual([]);
    expect(db.stripeEvents.has('evt_1')).toBe(true);
  });

  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'pagamento de pedido %s não é registrado, para o Stripe reenviar (etapa 4.3)',
    async (status) => {
      const { db, processor } = setup({ status });

      await expect(processor.process(paid())).rejects.toBeInstanceOf(UnexpectedPaymentError);

      expect(db.order(ORDER_ID)?.status).toBe(status);
      expect(db.tickets).toEqual([]);
      expect(db.outbox).toEqual([]);
      expect(db.stripeEvents.size).toBe(0);
    },
  );

  it.each([
    ['outra sessão', 'cs_test_outra'],
    ['nenhuma sessão', null],
  ])(
    'pagamento de uma sessão que não é a do pedido (%s) não é registrado',
    async (_, sessionId) => {
      const { db, processor } = setup({ stripeSessionId: sessionId });

      await expect(processor.process(paid())).rejects.toBeInstanceOf(UnexpectedPaymentError);

      expect(db.order(ORDER_ID)?.status).toBe('PENDING');
      expect(db.stripeEvents.size).toBe(0);
    },
  );

  it('erro no meio do processamento desfaz tudo, e reprocessar depois funciona', async () => {
    const { db, processor } = setup();
    db.beforeOutboxAdd = () => {
      throw new Error('falha simulada na outbox');
    };

    await expect(processor.process(paid())).rejects.toThrow('falha simulada na outbox');

    expect(db.order(ORDER_ID)?.status).toBe('PENDING');
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([]);
    expect(db.stripeEvents.size).toBe(0);

    db.beforeOutboxAdd = undefined;
    const retry = await processor.process(paid());

    expect(retry).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'PAID' });
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toHaveLength(1);
  });
});

describe('checkout.session.expired', () => {
  it('expira o pedido e devolve o estoque', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process(expired());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'EXPIRED' });
    expect(db.order(ORDER_ID)?.status).toBe('EXPIRED');
    expect(db.available(lotA)).toBe(2);
    expect(db.available(lotB)).toBe(6);
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([]);
    expect(db.stripeEvents.get('evt_1')).toBe(CHECKOUT_SESSION_EXPIRED);
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'pedido já %s (o próprio TicketFlow expirou a sessão) não devolve o estoque de novo',
    async (status) => {
      const { db, processor } = setup({ status });

      const outcome = await processor.process(expired());

      expect(outcome).toEqual({ status: 'ignored', reason: 'already-closed', orderId: ORDER_ID });
      expect(db.order(ORDER_ID)?.status).toBe(status);
      expect(db.releases).toEqual([]);
      expect(db.stripeEvents.has('evt_1')).toBe(true);
    },
  );

  it('sessão expirada que não é a do pedido não expira o pedido', async () => {
    const { db, processor } = setup({ stripeSessionId: 'cs_test_outra' });

    const outcome = await processor.process(expired());

    expect(outcome).toEqual({ status: 'ignored', reason: 'session-mismatch', orderId: ORDER_ID });
    expect(db.order(ORDER_ID)?.status).toBe('PENDING');
    expect(db.releases).toEqual([]);
  });

  it('o mesmo evento duas vezes devolve o estoque uma vez só', async () => {
    const { db, processor } = setup();

    await processor.process(expired());
    const second = await processor.process(expired());

    expect(second).toEqual({ status: 'duplicate' });
    expect(db.available(lotA)).toBe(2);
  });
});

describe('outros eventos', () => {
  it('tipo que o TicketFlow não trata é registrado sem mudar nada', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process({
      id: 'evt_9',
      type: 'charge.succeeded',
      createdAt: EVENT_CREATED_AT,
      session: null,
    });

    expect(outcome).toEqual({ status: 'ignored', reason: 'unhandled-type' });
    expect(db.stripeEvents.get('evt_9')).toBe('charge.succeeded');
    expect(db.locks).toEqual([]);
  });

  it('sessão que não é de um pedido do TicketFlow é registrada sem mudar nada', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process({ ...paid(), session: null });

    expect(outcome).toEqual({ status: 'ignored', reason: 'not-ticketflow' });
    expect(db.order(ORDER_ID)?.status).toBe('PENDING');
    expect(db.stripeEvents.has('evt_1')).toBe(true);
  });

  it('pedido inexistente (outro ambiente na mesma conta) é registrado sem mudar nada', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process(
      sessionEvent(CHECKOUT_SESSION_COMPLETED, { orderId: 'pedido-de-outro-ambiente' }),
    );

    expect(outcome).toEqual({
      status: 'ignored',
      reason: 'order-not-found',
      orderId: 'pedido-de-outro-ambiente',
    });
    expect(db.tickets).toEqual([]);
    expect(db.stripeEvents.has('evt_1')).toBe(true);
  });
});
