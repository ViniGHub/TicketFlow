import { type CreateOrderResponse, type ErrorResponse } from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import {
  chargeRefundedEvent,
  checkoutSessionEvent,
  type CheckoutSessionEventOptions,
  signWebhook,
} from '@ticketflow/payments/testing';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, type CookieJar, startTestApp, type TestApp, testEnv } from '../../test/app';
import { fixtures } from '../../test/fixtures';

// POST /webhooks/stripe com Postgres real (ROADMAP, etapas 4.2 e 4.3; ADRs 0009 e 0010). Os
// eventos são assinados como o Stripe assina (generateTestHeaderString), sem rede.

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const { createBuyer, createEvent, createLot, availableOf } = fixtures(prisma);
const WEBHOOK_SECRET = testEnv().STRIPE_WEBHOOK_SECRET;

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp();
});

afterAll(async () => {
  await api.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  await flushRedis(redisUrl);
  api.payments.reset();
});

/** Entrega o evento como o Stripe: corpo assinado, sem Origin nem cookies. */
function deliver(
  event: Record<string, unknown>,
  { signature, secret = WEBHOOK_SECRET }: { signature?: string; secret?: string } = {},
): Promise<Response> {
  const signed = signWebhook(event, secret);
  return fetch(`${api.url}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'stripe-signature': signature ?? signed.signature,
    },
    body: signed.body,
  });
}

interface PlacedOrder {
  id: string;
  sessionId: string;
  eventId: string;
  lotIds: [string, string];
  jar: CookieJar;
}

/**
 * Pedido criado pelo `POST /orders`, com a sessão do gateway fake gravada: 2 ingressos do
 * lote A e 1 do lote B, de 10 cada.
 */
async function placeOrder(priceCents = 8_000): Promise<PlacedOrder> {
  const buyer = await createBuyer();
  const event = await createEvent();
  const lotA = await createLot(event.id, { total: 10, priceCents });
  const lotB = await createLot(event.id, { total: 10, priceCents });
  const response = await call(api.url, '/orders', {
    method: 'POST',
    jar: buyer.jar,
    body: {
      items: [
        { ticketTypeId: lotA.id, quantity: 2 },
        { ticketTypeId: lotB.id, quantity: 1 },
      ],
    },
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as CreateOrderResponse;
  const stored = await prisma.order.findUniqueOrThrow({ where: { id } });
  return {
    id,
    sessionId: stored.stripeSessionId ?? '',
    eventId: event.id,
    lotIds: [lotA.id, lotB.id],
    jar: buyer.jar,
  };
}

function eventFor(
  order: PlacedOrder,
  options: Partial<CheckoutSessionEventOptions> = {},
): Record<string, unknown> {
  return checkoutSessionEvent({ sessionId: order.sessionId, orderId: order.id, ...options });
}

async function statusOf(orderId: string): Promise<string> {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

async function written(orderId: string) {
  const [tickets, outbox, stripeEvents] = await Promise.all([
    prisma.ticket.findMany({ where: { orderId } }),
    prisma.outbox.findMany(),
    prisma.stripeEvent.findMany(),
  ]);
  return { tickets, outbox, stripeEvents };
}

describe('POST /webhooks/stripe: assinatura', () => {
  it.each([
    ['inválida', { signature: 't=1700000000,v1=0000' }],
    ['feita com outro segredo', { secret: 'whsec_outro_segredo' }],
  ])('assinatura %s: 400 e nada gravado', async (_, options) => {
    const order = await placeOrder();

    const response = await deliver(eventFor(order), options);

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorResponse).code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect(await statusOf(order.id)).toBe('PENDING');
    expect(await written(order.id)).toEqual({ tickets: [], outbox: [], stripeEvents: [] });
  });
});

describe('POST /webhooks/stripe: checkout.session.completed', () => {
  it('PAID cria N tickets e exatamente 1 linha na outbox', async () => {
    const order = await placeOrder();
    const paidAt = new Date(Math.floor(Date.now() / 1000) * 1000);

    const response = await deliver(eventFor(order, { id: 'evt_pago', created: paidAt }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({
      status: 'PAID',
      paidAt,
      stripePaymentIntentId: `pi_test_${order.sessionId}`,
    });

    const { tickets, outbox, stripeEvents } = await written(order.id);
    expect(tickets).toHaveLength(3);
    expect(tickets.filter((ticket) => ticket.ticketTypeId === order.lotIds[0])).toHaveLength(2);
    expect(tickets.every((ticket) => ticket.eventId === order.eventId)).toBe(true);
    expect(tickets.every((ticket) => /^[A-Za-z0-9_-]{43}$/.test(ticket.qrToken))).toBe(true);
    expect(new Set(tickets.map((ticket) => ticket.qrToken)).size).toBe(3);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      type: 'send-ticket-email',
      payload: { orderId: order.id },
      publishedAt: null,
    });
    expect(stripeEvents).toMatchObject([
      { eventId: 'evt_pago', type: 'checkout.session.completed' },
    ]);
    // Pagamento não mexe no estoque: ele já estava reservado.
    expect(await availableOf(order.lotIds[0])).toBe(8);

    const view = await call(api.url, `/orders/${order.id}`, { jar: order.jar });
    expect(await view.json()).toMatchObject({ id: order.id, status: 'PAID' });
  });

  it('pedido grátis (sem cobrança) também vira PAID, sem PaymentIntent', async () => {
    const order = await placeOrder(0);

    const response = await deliver(
      eventFor(order, { paymentStatus: 'no_payment_required', paymentIntentId: null }),
    );

    expect(response.status).toBe(200);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ status: 'PAID', stripePaymentIntentId: null });
    expect((await written(order.id)).tickets).toHaveLength(3);
  });

  it('mesmo evento 2×: processado 1×', async () => {
    const order = await placeOrder();
    const event = eventFor(order, { id: 'evt_repetido' });

    const first = await deliver(event);
    const second = await deliver(event);

    expect([first.status, second.status]).toEqual([200, 200]);
    const { tickets, outbox, stripeEvents } = await written(order.id);
    expect(tickets).toHaveLength(3);
    expect(outbox).toHaveLength(1);
    expect(stripeEvents).toHaveLength(1);
  });

  it('mesmo evento entregue 5× ao mesmo tempo: processado 1×', async () => {
    const order = await placeOrder();
    const event = eventFor(order, { id: 'evt_simultaneo' });

    const responses = await Promise.all(Array.from({ length: 5 }, () => deliver(event)));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const { tickets, outbox, stripeEvents } = await written(order.id);
    expect(tickets).toHaveLength(3);
    expect(outbox).toHaveLength(1);
    expect(stripeEvents).toHaveLength(1);
  });

  describe('erro no meio do processamento', () => {
    // A gravação na outbox é o último passo: quando ela falha, todo o resto já foi feito na
    // transação e precisa ser desfeito.
    beforeEach(async () => {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'falha simulada na outbox'; END $$`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER test_fail_outbox BEFORE INSERT ON outbox
        FOR EACH ROW EXECUTE FUNCTION test_fail_outbox()`);
    });

    afterEach(async () => {
      await dropFailingTrigger();
    });

    async function dropFailingTrigger(): Promise<void> {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_outbox ON outbox');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_outbox()');
    }

    it('responde 5xx, nada fica gravado (nem em stripe_events) e reprocessar depois funciona', async () => {
      const order = await placeOrder();
      const event = eventFor(order, { id: 'evt_falha' });

      const failed = await deliver(event);

      expect(failed.status).toBe(500);
      expect(await statusOf(order.id)).toBe('PENDING');
      expect(await written(order.id)).toEqual({ tickets: [], outbox: [], stripeEvents: [] });

      await dropFailingTrigger();
      const retried = await deliver(event);

      expect(retried.status).toBe(200);
      expect(await statusOf(order.id)).toBe('PAID');
      const { tickets, outbox, stripeEvents } = await written(order.id);
      expect(tickets).toHaveLength(3);
      expect(outbox).toHaveLength(1);
      expect(stripeEvents).toHaveLength(1);
    });
  });
});

describe('POST /webhooks/stripe: checkout.session.expired', () => {
  it('expira o pedido e devolve o estoque', async () => {
    const order = await placeOrder();

    const response = await deliver(eventFor(order, { type: 'checkout.session.expired' }));

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('EXPIRED');
    expect(await availableOf(order.lotIds[0])).toBe(10);
    expect(await availableOf(order.lotIds[1])).toBe(10);
    expect((await written(order.id)).tickets).toEqual([]);
  });

  it('o aviso que chega depois do cancelamento não devolve o estoque de novo', async () => {
    const order = await placeOrder();
    const cancelled = await call(api.url, `/orders/${order.id}/cancel`, {
      method: 'POST',
      jar: order.jar,
    });
    expect(cancelled.status).toBe(200);
    expect(await availableOf(order.lotIds[0])).toBe(10);

    // O cancelamento expirou a sessão no Stripe, que avisa pelo webhook logo depois.
    const response = await deliver(eventFor(order, { type: 'checkout.session.expired' }));

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('CANCELLED');
    expect(await availableOf(order.lotIds[0])).toBe(10);
    expect(await availableOf(order.lotIds[1])).toBe(10);
  });
});

describe('POST /webhooks/stripe: outros eventos', () => {
  it('tipo que o TicketFlow não trata: 200 e registrado', async () => {
    const response = await deliver({
      id: 'evt_outro',
      object: 'event',
      type: 'charge.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'ch_1', object: 'charge' } },
    });

    expect(response.status).toBe(200);
    expect(await prisma.stripeEvent.findMany()).toMatchObject([
      { eventId: 'evt_outro', type: 'charge.succeeded' },
    ]);
  });

  it('pedido que não existe (outro ambiente na mesma conta): 200 e registrado', async () => {
    const response = await deliver(
      checkoutSessionEvent({
        id: 'evt_outro_ambiente',
        sessionId: 'cs_test_outro',
        orderId: '0193a4f2-0000-7000-8000-0000000000ff',
      }),
    );

    expect(response.status).toBe(200);
    expect(await prisma.stripeEvent.count()).toBe(1);
    expect(await prisma.ticket.count()).toBe(0);
  });
});

// Etapa 4.3 (ADR 0010): uma linha da tabela de transições da seção 4 por teste, nas que
// dependem de evento do Stripe. PENDING → PAID e PENDING → EXPIRED estão nos testes acima.
describe('POST /webhooks/stripe: tabela de transições (etapa 4.3)', () => {
  const paymentIntentOf = (order: PlacedOrder) => `pi_test_${order.sessionId}`;

  /**
   * Os dois lotes na ordem em que a re-reserva os percorre (ordem de id). Esgotar o segundo
   * garante que o primeiro já foi reservado quando falta estoque.
   */
  function lotsInReserveOrder(order: PlacedOrder): [string, string] {
    const [a, b] = order.lotIds;
    return a < b ? [a, b] : [b, a];
  }

  /** Sessão concluída com o pagamento assíncrono ainda pendente (Pix, boleto). */
  function asyncPending(order: PlacedOrder): Record<string, unknown> {
    return eventFor(order, { paymentStatus: 'unpaid', paymentIntentId: paymentIntentOf(order) });
  }

  async function ticketsOf(orderId: string) {
    return prisma.ticket.findMany({ where: { orderId } });
  }

  async function outboxTypes(): Promise<string[]> {
    return (await prisma.outbox.findMany()).map((row) => row.type);
  }

  it('PENDING → PROCESSING: sessão concluída sem pagamento confirmado', async () => {
    const order = await placeOrder();

    const response = await deliver(asyncPending(order));

    expect(response.status).toBe(200);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({
      status: 'PROCESSING',
      stripePaymentIntentId: paymentIntentOf(order),
      paidAt: null,
    });
    // O estoque continua reservado até o Stripe aprovar ou recusar.
    expect(await availableOf(order.lotIds[0])).toBe(8);
    expect(await ticketsOf(order.id)).toEqual([]);
  });

  it('PROCESSING → PAID: pagamento assíncrono aprovado', async () => {
    const order = await placeOrder();
    await deliver(asyncPending(order));

    const response = await deliver(
      eventFor(order, { type: 'checkout.session.async_payment_succeeded' }),
    );

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await ticketsOf(order.id)).toHaveLength(3);
    expect(await outboxTypes()).toEqual(['send-ticket-email']);
  });

  it('PROCESSING → EXPIRED: pagamento assíncrono recusado devolve o estoque', async () => {
    const order = await placeOrder();
    await deliver(asyncPending(order));

    const response = await deliver(
      eventFor(order, {
        type: 'checkout.session.async_payment_failed',
        paymentStatus: 'unpaid',
        paymentIntentId: paymentIntentOf(order),
      }),
    );

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('EXPIRED');
    expect(await availableOf(order.lotIds[0])).toBe(10);
    expect(await availableOf(order.lotIds[1])).toBe(10);
  });

  it('EXPIRED → PAID: pagamento tardio com estoque reserva de novo', async () => {
    const order = await placeOrder();
    await deliver(eventFor(order, { type: 'checkout.session.expired' }));
    expect(await availableOf(order.lotIds[0])).toBe(10);

    const response = await deliver(eventFor(order));

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await availableOf(order.lotIds[0])).toBe(8);
    expect(await availableOf(order.lotIds[1])).toBe(9);
    expect(await ticketsOf(order.id)).toHaveLength(3);
    expect(await outboxTypes()).toEqual(['send-ticket-email']);
  });

  it('EXPIRED → REFUND_PENDING: sem estoque, reembolso na outbox e nada descontado', async () => {
    const order = await placeOrder();
    await deliver(eventFor(order, { type: 'checkout.session.expired' }));
    // Outra compra levou um dos lotes inteiro; o outro ainda tem estoque.
    const [reservedFirst, soldOut] = lotsInReserveOrder(order);
    await prisma.ticketType.update({ where: { id: soldOut }, data: { available: 0 } });

    const response = await deliver(eventFor(order));

    expect(response.status).toBe(200);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({
      status: 'REFUND_PENDING',
      stripePaymentIntentId: paymentIntentOf(order),
    });
    // A reserva do primeiro lote, feita antes de o segundo faltar, voltou na mesma transação.
    expect(await availableOf(reservedFirst)).toBe(10);
    expect(await availableOf(soldOut)).toBe(0);
    expect(await ticketsOf(order.id)).toEqual([]);
    const outbox = await prisma.outbox.findMany();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'refund-order', payload: { orderId: order.id } });
  });

  it('REFUND_PENDING → REFUNDED: charge.refunded com o valor inteiro', async () => {
    const order = await placeOrder();
    await deliver(eventFor(order, { type: 'checkout.session.expired' }));
    const [reservedFirst, soldOut] = lotsInReserveOrder(order);
    await prisma.ticketType.update({ where: { id: soldOut }, data: { available: 0 } });
    await deliver(eventFor(order));
    expect(await statusOf(order.id)).toBe('REFUND_PENDING');

    const response = await deliver(
      chargeRefundedEvent({ paymentIntentId: paymentIntentOf(order) }),
    );

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('REFUNDED');
    // Reembolso não devolve estoque (seção 4): ele já tinha voltado na expiração.
    expect(await availableOf(reservedFirst)).toBe(10);
  });

  it('reembolso pelo painel de um pedido PAID: REFUNDED e todos os ingressos anulados', async () => {
    const order = await placeOrder();
    await deliver(eventFor(order));
    expect(await ticketsOf(order.id)).toHaveLength(3);
    const refundedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

    const response = await deliver(
      chargeRefundedEvent({ paymentIntentId: paymentIntentOf(order), created: refundedAt }),
    );

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('REFUNDED');
    const tickets = await ticketsOf(order.id);
    expect(tickets.map((ticket) => ticket.voidedAt)).toEqual([refundedAt, refundedAt, refundedAt]);
  });

  it('reembolso parcial: 200, registrado, e o pedido continua PAID', async () => {
    const order = await placeOrder();
    await deliver(eventFor(order));

    const response = await deliver(
      chargeRefundedEvent({
        paymentIntentId: paymentIntentOf(order),
        amountCents: 24_000,
        amountRefundedCents: 8_000,
      }),
    );

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect((await ticketsOf(order.id)).every((ticket) => ticket.voidedAt === null)).toBe(true);
    expect(await prisma.stripeEvent.count()).toBe(2);
  });
});
