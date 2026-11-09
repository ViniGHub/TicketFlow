import {
  type CheckInResponse,
  type ErrorResponse,
  type EventSalesResponse,
  type MyTicketResponse,
  type Page,
} from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, type CookieJar, sessionFor, startTestApp, type TestApp } from '../../test/app';
import { fixtures } from '../../test/fixtures';

// Ingressos, check-in e vendas com Postgres real (ROADMAP, etapa 4.4; ADR 0011).

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const { createBuyer, createEvent, createLot, createOrder, createPaidOrder, availableOf } =
  fixtures(prisma);

/** Formato válido de `qr_token` que não pertence a ingresso nenhum. */
const UNKNOWN_QR_TOKEN = 'bUHxdPPHbw2IBWVB1hgF_zY5KMs2HpWEq_QA7GHi0iw';

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
  /** Sessão do organizador dono do evento. */
  organizer: CookieJar;
}

/** Evento publicado com um lote de 10 ingressos, e a sessão do organizador dono. */
async function createVenue(priceCents = 8_000): Promise<Venue> {
  const event = await createEvent();
  const lot = await createLot(event.id, { total: 10, priceCents });
  return {
    eventId: event.id,
    lotId: lot.id,
    organizer: await sessionFor(event.organizerId, ['ORGANIZER']),
  };
}

async function ticketsOf(orderId: string) {
  return prisma.ticket.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
}

function checkIn(venue: Venue, qrToken: string, eventId = venue.eventId): Promise<Response> {
  return call(api.url, `/events/${eventId}/check-in`, {
    method: 'POST',
    jar: venue.organizer,
    body: { qrToken },
  });
}

describe('GET /me/tickets', () => {
  it('traz só os ingressos do comprador, com status, lote e evento, os mais novos primeiro', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const other = await createBuyer();
    const first = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    const second = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 2 }]);
    await createPaidOrder(other.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);

    const response = await call(api.url, '/me/tickets', { jar: buyer.jar });

    expect(response.status).toBe(200);
    const page = await json<Page<MyTicketResponse>>(response);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((ticket) => ticket.orderId)).toEqual([second.id, second.id, first.id]);
    expect(page.items[0]).toMatchObject({
      status: 'VALID',
      checkedInAt: null,
      voidedAt: null,
      ticketType: { id: venue.lotId, name: 'Pista' },
      event: { id: venue.eventId, title: 'Show de Teste' },
    });
    expect(page.items.every((ticket) => /^[A-Za-z0-9_-]{43}$/.test(ticket.qrToken))).toBe(true);
  });

  it('pagina por cursor sem repetir nem pular ingressos', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 3 }]);

    const first = await json<Page<MyTicketResponse>>(
      await call(api.url, '/me/tickets?limit=2', { jar: buyer.jar }),
    );
    const second = await json<Page<MyTicketResponse>>(
      await call(api.url, `/me/tickets?limit=2&cursor=${first.nextCursor ?? ''}`, {
        jar: buyer.jar,
      }),
    );

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((ticket) => ticket.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('ingresso usado e ingresso anulado aparecem com o status', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 2 }]);
    const [used, voided] = await ticketsOf(order.id);
    await checkIn(venue, used?.qrToken ?? '');
    await prisma.ticket.update({ where: { id: voided?.id }, data: { voidedAt: new Date() } });

    const page = await json<Page<MyTicketResponse>>(
      await call(api.url, '/me/tickets', { jar: buyer.jar }),
    );

    const statusOf = (id?: string) => page.items.find((ticket) => ticket.id === id)?.status;
    expect(statusOf(used?.id)).toBe('USED');
    expect(statusOf(voided?.id)).toBe('VOIDED');
  });
});

describe('POST /events/:id/check-in', () => {
  it('ingresso válido entra uma vez; a segunda leitura responde 409', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    const [ticket] = await ticketsOf(order.id);
    const qrToken = ticket?.qrToken ?? '';

    const first = await checkIn(venue, qrToken);
    const second = await checkIn(venue, qrToken);

    expect(first.status).toBe(200);
    const accepted = await json<CheckInResponse>(first);
    expect(accepted).toMatchObject({
      ticketId: ticket?.id,
      ticketType: { id: venue.lotId, name: 'Pista' },
    });
    expect(second.status).toBe(409);
    expect((await json<ErrorResponse>(second)).code).toBe('TICKET_ALREADY_USED');
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { qrToken } });
    expect(stored.checkedInAt?.toISOString()).toBe(accepted.checkedInAt);
  });

  it('10 check-ins simultâneos do mesmo ingresso: exatamente um válido', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    const [ticket] = await ticketsOf(order.id);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => checkIn(venue, ticket?.qrToken ?? '')),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    const codes = await Promise.all(
      responses
        .filter((response) => response.status === 409)
        .map(async (response) => (await json<ErrorResponse>(response)).code),
    );
    expect(new Set(codes)).toEqual(new Set(['TICKET_ALREADY_USED']));
  });

  it('ingresso de outro evento: 422, e ele continua sem check-in', async () => {
    const venue = await createVenue();
    const otherVenue = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [
      { ticketTypeId: otherVenue.lotId, quantity: 1 },
    ]);
    const [ticket] = await ticketsOf(order.id);

    const response = await checkIn(venue, ticket?.qrToken ?? '');

    expect(response.status).toBe(422);
    expect((await json<ErrorResponse>(response)).code).toBe('TICKET_FROM_OTHER_EVENT');
    expect((await ticketsOf(order.id))[0]?.checkedInAt).toBeNull();
  });

  it('ingresso anulado (reembolso): 409, e ele continua sem check-in', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    const [ticket] = await ticketsOf(order.id);
    await prisma.ticket.update({ where: { id: ticket?.id }, data: { voidedAt: new Date() } });

    const response = await checkIn(venue, ticket?.qrToken ?? '');

    expect(response.status).toBe(409);
    expect((await json<ErrorResponse>(response)).code).toBe('TICKET_VOIDED');
    expect((await ticketsOf(order.id))[0]?.checkedInAt).toBeNull();
  });

  it('qr_token sem ingresso: 404; em formato inválido: 400', async () => {
    const venue = await createVenue();

    const unknown = await checkIn(venue, UNKNOWN_QR_TOKEN);
    const malformed = await checkIn(venue, 'curto');

    expect(unknown.status).toBe(404);
    expect((await json<ErrorResponse>(unknown)).code).toBe('TICKET_NOT_FOUND');
    expect(malformed.status).toBe(400);
  });

  it('evento de outro organizador: 404, sem marcar o ingresso', async () => {
    const venue = await createVenue();
    const intruder = await createVenue();
    const buyer = await createBuyer();
    const order = await createPaidOrder(buyer.id, [{ ticketTypeId: venue.lotId, quantity: 1 }]);
    const [ticket] = await ticketsOf(order.id);

    const response = await call(api.url, `/events/${venue.eventId}/check-in`, {
      method: 'POST',
      jar: intruder.organizer,
      body: { qrToken: ticket?.qrToken },
    });

    expect(response.status).toBe(404);
    expect((await json<ErrorResponse>(response)).code).toBe('EVENT_NOT_FOUND');
    expect((await ticketsOf(order.id))[0]?.checkedInAt).toBeNull();
  });
});

describe('GET /events/:id/sales', () => {
  it('vendido e receita só de pagos, reservado de pendentes, pedidos por status', async () => {
    const event = await createEvent();
    const pista = await createLot(event.id, { total: 10, priceCents: 8_000 });
    const vip = await createLot(event.id, { total: 10, priceCents: 20_000 });
    const organizer = await sessionFor(event.organizerId, ['ORGANIZER']);
    const buyer = await createBuyer();
    // Um pedido pago com os dois lotes conta uma vez em PAID.
    await createPaidOrder(buyer.id, [
      { ticketTypeId: pista.id, quantity: 2 },
      { ticketTypeId: vip.id, quantity: 1 },
    ]);
    await createOrder(buyer.id, [{ ticketTypeId: pista.id, quantity: 1 }]);
    const refunded = await createPaidOrder(buyer.id, [{ ticketTypeId: vip.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: refunded.id }, data: { status: 'REFUNDED' } });

    const response = await call(api.url, `/events/${event.id}/sales`, { jar: organizer });

    expect(response.status).toBe(200);
    const sales = await json<EventSalesResponse>(response);
    expect(sales).toEqual({
      eventId: event.id,
      currency: 'BRL',
      ticketTypes: [
        {
          ticketTypeId: pista.id,
          name: 'Pista',
          priceCents: 8_000,
          total: 10,
          available: await availableOf(pista.id),
          sold: 2,
          reserved: 1,
          revenueCents: 16_000,
        },
        {
          ticketTypeId: vip.id,
          name: 'Pista',
          priceCents: 20_000,
          total: 10,
          available: await availableOf(vip.id),
          sold: 1,
          reserved: 0,
          revenueCents: 20_000,
        },
      ],
      totals: { sold: 3, reserved: 1, revenueCents: 36_000 },
      ordersByStatus: {
        PENDING: 1,
        PROCESSING: 0,
        PAID: 1,
        EXPIRED: 0,
        CANCELLED: 0,
        REFUND_PENDING: 0,
        REFUNDED: 1,
      },
    });
  });

  it('evento sem vendas: lotes e status zerados', async () => {
    const venue = await createVenue();

    const sales = await json<EventSalesResponse>(
      await call(api.url, `/events/${venue.eventId}/sales`, { jar: venue.organizer }),
    );

    expect(sales.ticketTypes).toMatchObject([{ sold: 0, reserved: 0, revenueCents: 0 }]);
    expect(Object.values(sales.ordersByStatus).every((count) => count === 0)).toBe(true);
  });

  it('organizador não vê as vendas de evento alheio: 404', async () => {
    const venue = await createVenue();
    const intruder = await createVenue();

    const response = await call(api.url, `/events/${venue.eventId}/sales`, {
      jar: intruder.organizer,
    });

    expect(response.status).toBe(404);
    expect((await json<ErrorResponse>(response)).code).toBe('EVENT_NOT_FOUND');
  });

  it('comprador sem o papel de organizador: 403', async () => {
    const venue = await createVenue();
    const buyer = await createBuyer();

    const response = await call(api.url, `/events/${venue.eventId}/sales`, { jar: buyer.jar });

    expect(response.status).toBe(403);
  });
});
