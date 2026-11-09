import {
  REFUND_ORDER_JOB,
  SEND_EVENT_CANCELLED_EMAIL_JOB,
  SEND_TICKET_EMAIL_JOB,
} from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';
import { type ChargeState, type CheckoutSessionState, type PaymentEvent } from './ports.js';
import {
  CHARGE_REFUNDED,
  CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED,
  CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED,
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

/**
 * Pedido de 2 ingressos do lote A e 1 do B, com a sessão gravada. Por padrão o estoque já está
 * descontado e o lote A esgotou.
 */
function setup(overrides: Partial<Order> = {}, available = { a: 0, b: 5 }) {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: available.a });
  db.addTicketType(lotB, { available: available.b });
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
    charge: null,
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

  it('pagamento de pedido CANCELLED não é registrado, para o Stripe reenviar', async () => {
    const { db, processor } = setup({ status: 'CANCELLED' });

    await expect(processor.process(paid())).rejects.toBeInstanceOf(UnexpectedPaymentError);

    expect(db.order(ORDER_ID)?.status).toBe('CANCELLED');
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([]);
    expect(db.stripeEvents.size).toBe(0);
  });

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
      charge: null,
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

const pending = (id = 'evt_1') =>
  sessionEvent(
    CHECKOUT_SESSION_COMPLETED,
    { paymentStatus: 'unpaid', paymentIntentId: 'pi_1' },
    id,
  );
const asyncSucceeded = (id = 'evt_2') =>
  sessionEvent(CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED, { paymentStatus: 'paid' }, id);
const asyncFailed = (id = 'evt_2') =>
  sessionEvent(
    CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED,
    { paymentStatus: 'unpaid', paymentIntentId: 'pi_1' },
    id,
  );

describe('pagamento assíncrono (Pix, boleto)', () => {
  it('sessão concluída sem pagamento confirmado: PENDING → PROCESSING, estoque reservado', async () => {
    const { db, processor } = setup();

    const outcome = await processor.process(pending());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'PROCESSING' });
    expect(db.order(ORDER_ID)).toMatchObject({
      status: 'PROCESSING',
      stripePaymentIntentId: 'pi_1',
      paidAt: null,
    });
    expect(db.releases).toEqual([]);
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([]);
  });

  it('pagamento aprovado: PROCESSING → PAID, ingressos e e-mail', async () => {
    const { db, processor } = setup({ status: 'PROCESSING', stripePaymentIntentId: 'pi_1' });

    const outcome = await processor.process(asyncSucceeded());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'PAID' });
    expect(db.order(ORDER_ID)).toMatchObject({ status: 'PAID', paidAt: EVENT_CREATED_AT });
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toEqual([{ type: SEND_TICKET_EMAIL_JOB, payload: { orderId: ORDER_ID } }]);
  });

  it('pagamento recusado: PROCESSING → EXPIRED e o estoque volta', async () => {
    const { db, processor } = setup({ status: 'PROCESSING', stripePaymentIntentId: 'pi_1' });

    const outcome = await processor.process(asyncFailed());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'EXPIRED' });
    expect(db.available(lotA)).toBe(2);
    expect(db.available(lotB)).toBe(6);
    expect(db.tickets).toEqual([]);
  });

  it('aprovação que chega antes do completed: PENDING → PAID, e o completed depois é ignorado', async () => {
    const { db, processor } = setup();

    await processor.process(asyncSucceeded('evt_2'));
    const late = await processor.process(pending('evt_1'));

    expect(db.order(ORDER_ID)?.status).toBe('PAID');
    expect(late).toEqual({ status: 'ignored', reason: 'already-paid', orderId: ORDER_ID });
    expect(db.tickets).toHaveLength(3);
  });

  it('recusa que chega antes do completed: PENDING → EXPIRED, e o completed depois é ignorado', async () => {
    const { db, processor } = setup();

    await processor.process(asyncFailed('evt_2'));
    const late = await processor.process(pending('evt_1'));

    expect(db.order(ORDER_ID)?.status).toBe('EXPIRED');
    expect(late).toEqual({ status: 'ignored', reason: 'already-closed', orderId: ORDER_ID });
    expect(db.available(lotA)).toBe(2);
  });

  it('recusa repetida por outro evento não devolve o estoque de novo', async () => {
    const { db, processor } = setup({ status: 'PROCESSING', stripePaymentIntentId: 'pi_1' });

    await processor.process(asyncFailed('evt_2'));
    const again = await processor.process(asyncFailed('evt_3'));

    expect(again).toEqual({ status: 'ignored', reason: 'already-closed', orderId: ORDER_ID });
    expect(db.available(lotA)).toBe(2);
  });

  it.each([
    ['sessão concluída', pending],
    ['pagamento recusado', asyncFailed],
  ])('%s de outra sessão não muda o pedido', async (_, event) => {
    const { db, processor } = setup({ stripeSessionId: 'cs_test_outra' });

    const outcome = await processor.process(event());

    expect(outcome).toEqual({ status: 'ignored', reason: 'session-mismatch', orderId: ORDER_ID });
    expect(db.order(ORDER_ID)?.status).toBe('PENDING');
  });
});

describe('pagamento tardio (pedido EXPIRED)', () => {
  it('com estoque: reserva de novo e vira PAID, com ingressos e e-mail', async () => {
    const { db, processor } = setup({ status: 'EXPIRED' }, { a: 10, b: 10 });

    const outcome = await processor.process(paid());

    expect(outcome).toEqual({
      status: 'processed',
      orderId: ORDER_ID,
      orderStatus: 'PAID',
      warning: 'late-payment-reserved',
    });
    expect(db.available(lotA)).toBe(8);
    expect(db.available(lotB)).toBe(9);
    expect(db.tickets).toHaveLength(3);
    expect(db.outbox).toEqual([{ type: SEND_TICKET_EMAIL_JOB, payload: { orderId: ORDER_ID } }]);
  });

  it('outro erro no meio do pagamento tardio não vira reembolso: desfaz tudo', async () => {
    const { db, processor } = setup({ status: 'EXPIRED' }, { a: 10, b: 10 });
    db.beforeOutboxAdd = () => {
      throw new Error('falha simulada na outbox');
    };

    await expect(processor.process(paid())).rejects.toThrow('falha simulada na outbox');

    expect(db.order(ORDER_ID)?.status).toBe('EXPIRED');
    expect(db.available(lotA)).toBe(10);
    expect(db.outbox).toEqual([]);
    expect(db.stripeEvents.size).toBe(0);
  });

  it('pagamento assíncrono aprovado de pedido expirado segue o mesmo caminho', async () => {
    const { db, processor } = setup({ status: 'EXPIRED' }, { a: 10, b: 10 });

    await processor.process(asyncSucceeded());

    expect(db.order(ORDER_ID)?.status).toBe('PAID');
  });

  it('sem estoque: REFUND_PENDING, refund-order na outbox, nenhum ingresso e nada descontado', async () => {
    // O lote A tem estoque e o B não: a reserva do A precisa voltar.
    const { db, processor } = setup({ status: 'EXPIRED' }, { a: 10, b: 0 });

    const outcome = await processor.process(paid());

    expect(outcome).toEqual({
      status: 'processed',
      orderId: ORDER_ID,
      orderStatus: 'REFUND_PENDING',
      warning: 'late-payment-refund',
    });
    expect(db.order(ORDER_ID)).toMatchObject({
      status: 'REFUND_PENDING',
      stripePaymentIntentId: 'pi_1',
      paidAt: EVENT_CREATED_AT,
    });
    expect(db.available(lotA)).toBe(10);
    expect(db.available(lotB)).toBe(0);
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([{ type: REFUND_ORDER_JOB, payload: { orderId: ORDER_ID } }]);
    expect(db.stripeEvents.has('evt_1')).toBe(true);
  });

  it('pedido grátis sem estoque não tem o que reembolsar: não é registrado', async () => {
    const { db, processor } = setup({ status: 'EXPIRED', totalCents: 0 }, { a: 0, b: 0 });

    await expect(
      processor.process(
        sessionEvent(CHECKOUT_SESSION_COMPLETED, {
          paymentStatus: 'no_payment_required',
          paymentIntentId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(UnexpectedPaymentError);

    expect(db.order(ORDER_ID)?.status).toBe('EXPIRED');
    expect(db.stripeEvents.size).toBe(0);
  });

  it('o mesmo pagamento tardio entregue de novo não reembolsa duas vezes', async () => {
    const { db, processor } = setup({ status: 'EXPIRED' }, { a: 0, b: 0 });

    await processor.process(paid('evt_1'));
    const again = await processor.process(paid('evt_9'));

    expect(again).toEqual({ status: 'ignored', reason: 'already-paid', orderId: ORDER_ID });
    expect(db.outbox).toHaveLength(1);
  });
});

function refundedCharge(charge: Partial<ChargeState> = {}, id = 'evt_r1'): PaymentEvent {
  return {
    id,
    type: CHARGE_REFUNDED,
    createdAt: EVENT_CREATED_AT,
    session: null,
    charge: { id: 'ch_1', paymentIntentId: 'pi_1', fullyRefunded: true, ...charge },
  };
}

describe('charge.refunded', () => {
  it('REFUND_PENDING → REFUNDED, sem devolver estoque', async () => {
    const { db, processor } = setup({ status: 'REFUND_PENDING', stripePaymentIntentId: 'pi_1' });

    const outcome = await processor.process(refundedCharge());

    expect(outcome).toEqual({ status: 'processed', orderId: ORDER_ID, orderStatus: 'REFUNDED' });
    expect(db.order(ORDER_ID)?.status).toBe('REFUNDED');
    expect(db.locks).toEqual([ORDER_ID]);
    expect(db.releases).toEqual([]);
    expect(db.ticketVoids).toEqual([{ orderId: ORDER_ID, voidedAt: EVENT_CREATED_AT }]);
  });

  it('reembolso pelo painel de um pedido PAID: REFUNDED e os ingressos anulados', async () => {
    const { db, processor } = setup({ status: 'PAID', stripePaymentIntentId: 'pi_1' });

    const outcome = await processor.process(refundedCharge());

    expect(outcome).toEqual({
      status: 'processed',
      orderId: ORDER_ID,
      orderStatus: 'REFUNDED',
      warning: 'refunded-outside-ticketflow',
    });
    expect(db.order(ORDER_ID)?.status).toBe('REFUNDED');
    expect(db.ticketVoids).toEqual([{ orderId: ORDER_ID, voidedAt: EVENT_CREATED_AT }]);
  });

  it('o mesmo reembolso de novo, por outro evento, não muda nada', async () => {
    const { db, processor } = setup({ status: 'REFUND_PENDING', stripePaymentIntentId: 'pi_1' });

    await processor.process(refundedCharge({}, 'evt_r1'));
    const again = await processor.process(refundedCharge({}, 'evt_r2'));

    expect(again).toEqual({ status: 'ignored', reason: 'already-refunded', orderId: ORDER_ID });
    expect(db.ticketVoids).toHaveLength(1);
  });

  it('reembolso parcial é registrado sem mudar o pedido', async () => {
    const { db, processor } = setup({ status: 'PAID', stripePaymentIntentId: 'pi_1' });

    const outcome = await processor.process(refundedCharge({ fullyRefunded: false }));

    expect(outcome).toEqual({ status: 'ignored', reason: 'partial-refund', orderId: ORDER_ID });
    expect(db.order(ORDER_ID)?.status).toBe('PAID');
    expect(db.ticketVoids).toEqual([]);
    expect(db.stripeEvents.has('evt_r1')).toBe(true);
  });

  it.each(['EXPIRED', 'PROCESSING'] as const)(
    'reembolso de pedido %s (sem ingressos) é registrado sem mudar o pedido',
    async (status) => {
      const { db, processor } = setup({ status, stripePaymentIntentId: 'pi_1' });

      const outcome = await processor.process(refundedCharge());

      expect(outcome).toEqual({ status: 'ignored', reason: 'not-refundable', orderId: ORDER_ID });
      expect(db.order(ORDER_ID)?.status).toBe(status);
    },
  );

  it('charge de outro pagamento ou sem PaymentIntent é registrada sem mudar nada', async () => {
    const { db, processor } = setup({ status: 'PAID', stripePaymentIntentId: 'pi_1' });

    const other = await processor.process(refundedCharge({ paymentIntentId: 'pi_outro' }, 'e1'));
    const none = await processor.process(refundedCharge({ paymentIntentId: null }, 'e2'));
    const missing = await processor.process({ ...refundedCharge({}, 'e3'), charge: null });

    expect(other).toEqual({ status: 'ignored', reason: 'order-not-found' });
    expect(none).toEqual({ status: 'ignored', reason: 'not-ticketflow' });
    expect(missing).toEqual({ status: 'ignored', reason: 'not-ticketflow' });
    expect(db.order(ORDER_ID)?.status).toBe('PAID');
  });
});

describe('pagamento de evento cancelado (ADR 0015)', () => {
  /** Mesmo pedido do setup, com o evento dos lotes já cancelado. */
  function cancelledSetup(overrides: Partial<Order> = {}) {
    const context = setup(overrides, { a: 10, b: 10 });
    context.db.addEvent('evento-1', { status: 'CANCELLED' });
    return context;
  }

  const refundJobs = [
    { type: REFUND_ORDER_JOB, payload: { orderId: ORDER_ID } },
    { type: SEND_EVENT_CANCELLED_EMAIL_JOB, payload: { orderId: ORDER_ID } },
  ];

  it('pedido pendente pago depois do cancelamento: pagamento registrado e devolvido, sem ingressos', async () => {
    const { db, processor } = cancelledSetup();

    const outcome = await processor.process(paid());

    expect(outcome).toEqual({
      status: 'processed',
      orderId: ORDER_ID,
      orderStatus: 'REFUND_PENDING',
      warning: 'cancelled-event-refund',
    });
    expect(db.order(ORDER_ID)).toMatchObject({
      status: 'REFUND_PENDING',
      paidAt: EVENT_CREATED_AT,
      stripePaymentIntentId: 'pi_1',
    });
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual(refundJobs);
    expect(db.reservations).toEqual([]);
    expect(db.releases).toEqual([]);
  });

  it('Pix aprovado depois do cancelamento: PROCESSING vira reembolso', async () => {
    const { db, processor } = cancelledSetup({
      status: 'PROCESSING',
      stripePaymentIntentId: 'pi_1',
    });

    const outcome = await processor.process(asyncSucceeded());

    expect(outcome).toMatchObject({ orderStatus: 'REFUND_PENDING' });
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual(refundJobs);
  });

  it('Pix ainda pendente continua em PROCESSING: só a aprovação vira reembolso', async () => {
    const { db, processor } = cancelledSetup();

    const outcome = await processor.process(pending());

    expect(outcome).toMatchObject({ orderStatus: 'PROCESSING' });
    expect(db.outbox).toEqual([]);
  });

  it('pagamento tardio de evento cancelado não reserva estoque: vai direto para o reembolso', async () => {
    const { db, processor } = cancelledSetup({ status: 'EXPIRED' });

    const outcome = await processor.process(paid());

    expect(outcome).toMatchObject({ orderStatus: 'REFUND_PENDING' });
    expect(db.order(ORDER_ID)).toMatchObject({ paidAt: EVENT_CREATED_AT });
    expect(db.reservations).toEqual([]);
    expect(db.outbox).toEqual(refundJobs);
  });

  it('pedido grátis de evento cancelado: REFUNDED na hora, só o e-mail', async () => {
    const { db, processor } = cancelledSetup({ totalCents: 0 });

    const outcome = await processor.process(
      sessionEvent(CHECKOUT_SESSION_COMPLETED, {
        paymentStatus: 'no_payment_required',
        paymentIntentId: null,
      }),
    );

    expect(outcome).toMatchObject({ orderStatus: 'REFUNDED' });
    expect(db.tickets).toEqual([]);
    expect(db.outbox).toEqual([
      { type: SEND_EVENT_CANCELLED_EMAIL_JOB, payload: { orderId: ORDER_ID } },
    ]);
  });

  it('o mesmo pagamento entregue de novo não reembolsa duas vezes', async () => {
    const { db, processor } = cancelledSetup();

    await processor.process(paid('evt_1'));
    const again = await processor.process(paid('evt_2'));

    expect(again).toEqual({ status: 'ignored', reason: 'already-paid', orderId: ORDER_ID });
    expect(db.outbox).toEqual(refundJobs);
  });
});
