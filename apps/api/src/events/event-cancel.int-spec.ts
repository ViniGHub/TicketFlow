import {
  type ErrorResponse,
  type EventResponse,
  REFUND_ORDER_JOB,
  SEND_EVENT_CANCELLED_EMAIL_JOB,
} from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { CHECKOUT_SESSION_COMPLETED, StripeEventProcessor } from '@ticketflow/domain';
import { PrismaUnitOfWork } from '@ticketflow/persistence';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, type CookieJar, sessionFor, startTestApp, type TestApp } from '../../test/app';
import { fixtures } from '../../test/fixtures';

// Cancelamento de evento com Postgres real (ROADMAP, etapa 5.4; ADR 0015).

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const { createBuyer, createEvent, createLot, createOrder, createPaidOrder, availableOf } =
  fixtures(prisma);

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
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Venue {
  eventId: string;
  lotId: string;
  organizer: CookieJar;
}

/** Evento publicado com um lote de 10 ingressos, e a sessão do organizador dono. */
async function createVenue(status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED'): Promise<Venue> {
  const event = await createEvent(status);
  const lot = await createLot(event.id, { total: 10 });
  return {
    eventId: event.id,
    lotId: lot.id,
    organizer: await sessionFor(event.organizerId, ['ORGANIZER']),
  };
}

function cancel(venue: Venue, jar = venue.organizer): Promise<Response> {
  return call(api.url, `/events/${venue.eventId}/cancel`, { method: 'POST', jar });
}

async function outboxOf(type: string) {
  const rows = await prisma.outbox.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });
  return rows.map((row) => row.payload);
}

describe('POST /events/:id/cancel', () => {
  it('reembolsa os pedidos pagos, anula os ingressos e encerra as reservas, numa transação', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const paid = await Promise.all(
      [1, 2, 3].map(() => createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }])),
    );
    const pending = await createOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 2 }]);
    const before = new Date();

    const response = await cancel(venue);

    expect(response.status).toBe(200);
    expect(await json<EventResponse>(response)).toMatchObject({
      id: venue.eventId,
      status: 'CANCELLED',
    });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: venue.eventId } });
    expect(event.cancelledAt).not.toBeNull();

    const orders = await prisma.order.findMany({ where: { id: { in: paid.map((o) => o.id) } } });
    expect(orders.map((order) => order.status)).toEqual(Array(3).fill('REFUND_PENDING'));
    const tickets = await prisma.ticket.findMany({
      where: { orderId: { in: paid.map((o) => o.id) } },
    });
    expect(tickets).toHaveLength(3);
    expect(tickets.every((ticket) => ticket.voidedAt !== null)).toBe(true);

    const ids = paid
      .map((order) => ({ orderId: order.id }))
      .sort((a, b) => a.orderId.localeCompare(b.orderId));
    const sorted = (payloads: unknown[]) =>
      [...(payloads as { orderId: string }[])].sort((a, b) => a.orderId.localeCompare(b.orderId));
    expect(sorted(await outboxOf(REFUND_ORDER_JOB))).toEqual(ids);
    expect(sorted(await outboxOf(SEND_EVENT_CANCELLED_EMAIL_JOB))).toEqual(ids);

    // A reserva pendente acabou; o estoque só volta quando o expire-orders expirar a sessão.
    const ended = await prisma.order.findUniqueOrThrow({ where: { id: pending.id } });
    expect(ended.status).toBe('PENDING');
    expect(ended.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(ended.expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1_000);
    expect(await availableOf(venue.lotId)).toBe(10 - 3 - 2);
  });

  it('cancelar de novo devolve o evento cancelado sem gravar nada', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    await cancel(venue);

    const again = await cancel(venue);

    expect(again.status).toBe(200);
    expect(await json<EventResponse>(again)).toMatchObject({ status: 'CANCELLED' });
    expect(await outboxOf(REFUND_ORDER_JOB)).toHaveLength(1);
  });

  it('depois do cancelamento, a compra é recusada', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    await cancel(venue);

    const response = await call(api.url, '/orders', {
      method: 'POST',
      jar: buyer.jar,
      body: { items: [{ ticketTypeId: venue.lotId, quantity: 1 }] },
    });

    expect(response.status).toBe(409);
    expect((await json<ErrorResponse>(response)).code).toBe('EVENT_NOT_PUBLISHED');
  });

  it('pagamento que chega depois do cancelamento vira reembolso, sem ingressos', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const order = await createOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 2 }]);
    const sessionId = `cs_test_${order.id}`;
    await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: sessionId } });
    await cancel(venue);

    const outcome = await new StripeEventProcessor(new PrismaUnitOfWork(prisma)).process({
      id: `evt_depois_${order.id}`,
      type: CHECKOUT_SESSION_COMPLETED,
      createdAt: new Date(),
      session: {
        id: sessionId,
        orderId: order.id,
        status: 'complete',
        paymentStatus: 'paid',
        paymentIntentId: `pi_test_${order.id}`,
        url: null,
      },
      charge: null,
    });

    expect(outcome).toMatchObject({
      status: 'processed',
      orderStatus: 'REFUND_PENDING',
      warning: 'cancelled-event-refund',
    });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
    expect(await outboxOf(REFUND_ORDER_JOB)).toEqual([{ orderId: order.id }]);
    expect(await outboxOf(SEND_EVENT_CANCELLED_EMAIL_JOB)).toEqual([{ orderId: order.id }]);
  });

  it('evento de outro organizador responde 404, e nada muda', async () => {
    const venue = await createVenue();
    const intruder = await createVenue();

    const response = await cancel(venue, intruder.organizer);

    expect(response.status).toBe(404);
    expect((await json<ErrorResponse>(response)).code).toBe('EVENT_NOT_FOUND');
    const event = await prisma.event.findUniqueOrThrow({ where: { id: venue.eventId } });
    expect(event.status).toBe('PUBLISHED');
  });

  it('rascunho responde 409 EVENT_NOT_CANCELLABLE', async () => {
    const venue = await createVenue('DRAFT');

    const response = await cancel(venue);

    expect(response.status).toBe(409);
    expect((await json<ErrorResponse>(response)).code).toBe('EVENT_NOT_CANCELLABLE');
  });

  it('comprador não cancela evento: 403', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();

    const response = await cancel(venue, buyer.jar);

    expect(response.status).toBe(403);
  });
});
