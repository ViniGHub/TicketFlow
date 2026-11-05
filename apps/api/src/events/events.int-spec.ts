import {
  type ErrorResponse,
  type EventResponse,
  type EventSummaryResponse,
  type Page,
  type TicketTypeResponse,
} from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { DEV_PASSWORD, seed } from '@ticketflow/db/seed';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, type CookieJar, login, startTestApp, type TestApp } from '../../test/app';

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);

// Usuários do seed (packages/db/src/seed/seed.ts).
const ORGANIZER = 'organizador@ticketflow.local';
const OTHER_ORGANIZER = 'ambos@ticketflow.local';
const BUYER = 'comprador@ticketflow.local';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

/** A mesma data escrita no fuso -03:00 (ex.: `21:00-03:00` em vez de `00:00Z`). */
function atMinusThree(date: Date): string {
  return new Date(date.getTime() - 3 * HOUR_MS).toISOString().replace('Z', '-03:00');
}

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
  // Zera o rate limit do login entre os testes.
  await flushRedis(redisUrl);
  await seed(prisma);
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function errorCode(response: Response): Promise<string> {
  return (await json<ErrorResponse>(response)).code;
}

function loginAs(email: string): Promise<CookieJar> {
  return login(api.url, email, DEV_PASSWORD);
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Festival de Inverno',
    venue: 'Teatro Municipal',
    timezone: 'America/Sao_Paulo',
    startsAt: inDays(60).toISOString(),
    ...overrides,
  };
}

function ticketTypeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Pista',
    priceCents: 5_000,
    total: 10,
    salesStart: inDays(-1).toISOString(),
    salesEnd: inDays(59).toISOString(),
    maxPerOrder: 4,
    ...overrides,
  };
}

async function createEvent(
  jar: CookieJar,
  overrides: Record<string, unknown> = {},
): Promise<EventResponse> {
  const response = await call(api.url, '/events', {
    method: 'POST',
    body: eventBody(overrides),
    jar,
  });
  expect(response.status).toBe(201);
  return json<EventResponse>(response);
}

async function createTicketType(
  jar: CookieJar,
  eventId: string,
  overrides: Record<string, unknown> = {},
): Promise<TicketTypeResponse> {
  const response = await call(api.url, `/events/${eventId}/ticket-types`, {
    method: 'POST',
    body: ticketTypeBody(overrides),
    jar,
  });
  expect(response.status).toBe(201);
  return json<TicketTypeResponse>(response);
}

async function organizerId(email: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

/** Cria o evento direto no banco: permite status e datas que a API não aceitaria. */
async function insertEvent(data: {
  organizerId: string;
  startsAt: Date;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
}): Promise<{ id: string; startsAt: Date }> {
  return prisma.event.create({
    data: { ...data, title: 'Evento', description: '', venue: 'Local', timezone: 'UTC' },
    select: { id: true, startsAt: true },
  });
}

async function publicIds(query: Record<string, string>): Promise<string[]> {
  const response = await call(api.url, `/events?${new URLSearchParams(query).toString()}`);
  expect(response.status).toBe(200);
  const page = await json<Page<EventSummaryResponse>>(response);
  return page.items.map((item) => item.id);
}

describe('jornada do organizador (pronto quando da etapa 2.1)', () => {
  it('cria o evento, cadastra um lote, publica e o vê no catálogo público', async () => {
    const jar = await loginAs(ORGANIZER);
    const startsAt = new Date(Math.floor(inDays(60).getTime() / 1000) * 1000);

    const created = await createEvent(jar, { startsAt: atMinusThree(startsAt) });
    expect(created).toMatchObject({
      status: 'DRAFT',
      startsAt: startsAt.toISOString(),
      timezone: 'America/Sao_Paulo',
      description: '',
      ticketTypes: [],
    });

    // Rascunho não aparece para o público.
    expect((await call(api.url, `/events/${created.id}`)).status).toBe(404);
    expect(await publicIds({ limit: '50' })).not.toContain(created.id);

    const ticketType = await createTicketType(jar, created.id, {
      salesEnd: atMinusThree(new Date(startsAt.getTime() - HOUR_MS)),
    });
    expect(ticketType).toMatchObject({ total: 10, available: 10, priceCents: 5_000 });

    const published = await call(api.url, `/events/${created.id}/publish`, {
      method: 'POST',
      jar,
    });
    expect(published.status).toBe(200);
    expect(await json<EventResponse>(published)).toMatchObject({ status: 'PUBLISHED' });

    expect(await publicIds({ limit: '50' })).toContain(created.id);
    const detail = await call(api.url, `/events/${created.id}`);
    expect(detail.status).toBe(200);
    expect(await json<EventResponse>(detail)).toMatchObject({
      id: created.id,
      status: 'PUBLISHED',
      ticketTypes: [{ id: ticketType.id, name: 'Pista', available: 10, maxPerOrder: 4 }],
    });
  });

  it('a lista do organizador mostra rascunhos, os mais novos primeiro, e pagina', async () => {
    const jar = await loginAs(ORGANIZER);
    const draft = await createEvent(jar);

    const first = await call(api.url, '/me/events?limit=1', { jar });
    expect(first.status).toBe(200);
    const firstPage = await json<Page<EventResponse>>(first);
    expect(firstPage.items.map((event) => [event.id, event.status])).toEqual([[draft.id, 'DRAFT']]);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await call(
      api.url,
      `/me/events?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      { jar },
    );
    const secondPage = await json<Page<EventResponse>>(second);
    // O evento publicado do seed ("Jazz no Parque"), com os dois lotes.
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.ticketTypes).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();
  });
});

describe('autorização', () => {
  it('organizador não vê nem altera evento de outro organizador (404)', async () => {
    const owner = await loginAs(ORGANIZER);
    const event = await createEvent(owner);
    const ticketType = await createTicketType(owner, event.id);
    const intruder = await loginAs(OTHER_ORGANIZER);

    const attempts = [
      call(api.url, `/events/${event.id}`, {
        method: 'PATCH',
        body: { title: 'x' },
        jar: intruder,
      }),
      call(api.url, `/events/${event.id}/publish`, { method: 'POST', jar: intruder }),
      call(api.url, `/events/${event.id}`, { method: 'DELETE', jar: intruder }),
      call(api.url, `/events/${event.id}/ticket-types`, {
        method: 'POST',
        body: ticketTypeBody(),
        jar: intruder,
      }),
      call(api.url, `/events/${event.id}/ticket-types/${ticketType.id}`, {
        method: 'PATCH',
        body: { total: 1 },
        jar: intruder,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe('EVENT_NOT_FOUND');
    }

    const mine = await json<Page<EventResponse>>(
      await call(api.url, '/me/events', { jar: intruder }),
    );
    expect(mine.items.map((item) => item.id)).not.toContain(event.id);

    // Nada mudou.
    const stored = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { ticketTypes: true },
    });
    expect(stored).toMatchObject({ title: 'Festival de Inverno', status: 'DRAFT' });
    expect(stored.ticketTypes).toHaveLength(1);
    expect(stored.ticketTypes[0]?.total).toBe(10);
  });

  it('lote de outro evento do mesmo organizador responde 404', async () => {
    const jar = await loginAs(ORGANIZER);
    const first = await createEvent(jar);
    const second = await createEvent(jar);
    const ticketType = await createTicketType(jar, first.id);

    const response = await call(api.url, `/events/${second.id}/ticket-types/${ticketType.id}`, {
      method: 'PATCH',
      body: { total: 1 },
      jar,
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('TICKET_TYPE_NOT_FOUND');
  });

  it('comprador não cria evento (403) e quem não está logado recebe 401', async () => {
    const buyer = await loginAs(BUYER);

    const asBuyer = await call(api.url, '/events', {
      method: 'POST',
      body: eventBody(),
      jar: buyer,
    });
    expect(asBuyer.status).toBe(403);
    expect(await errorCode(asBuyer)).toBe('INSUFFICIENT_ROLE');
    expect((await call(api.url, '/me/events', { jar: buyer })).status).toBe(403);

    const anonymous = await call(api.url, '/events', { method: 'POST', body: eventBody() });
    expect(anonymous.status).toBe(401);
    expect(await prisma.event.count({ where: { title: 'Festival de Inverno' } })).toBe(0);
  });

  it('id malformado na rota responde 400, não 500', async () => {
    const jar = await loginAs(ORGANIZER);

    const response = await call(api.url, '/events/nao-e-uuid', {
      method: 'PATCH',
      body: { title: 'x' },
      jar,
    });
    expect(response.status).toBe(400);
    expect(await json<ErrorResponse>(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'id' }],
    });
    expect((await call(api.url, '/events/nao-e-uuid')).status).toBe(400);
  });
});

describe('catálogo público', () => {
  // Além dos dois eventos publicados do seed (daqui a 14 e 30 dias): dois na mesma data
  // (o id desempata), um mais distante, um rascunho e um que já aconteceu.
  async function populate() {
    const owner = await organizerId(ORGANIZER);
    const sameDay = inDays(20);
    const extra = {
      tiedA: await insertEvent({ organizerId: owner, startsAt: sameDay, status: 'PUBLISHED' }),
      tiedB: await insertEvent({ organizerId: owner, startsAt: sameDay, status: 'PUBLISHED' }),
      later: await insertEvent({ organizerId: owner, startsAt: inDays(45), status: 'PUBLISHED' }),
      draft: await insertEvent({ organizerId: owner, startsAt: inDays(10), status: 'DRAFT' }),
      past: await insertEvent({ organizerId: owner, startsAt: inDays(-1), status: 'PUBLISHED' }),
    };
    const seeded = await prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        startsAt: { gt: new Date() },
        id: { notIn: [extra.tiedA.id, extra.tiedB.id, extra.later.id] },
      },
      select: { id: true, startsAt: true },
    });
    expect(seeded).toHaveLength(2);
    return { ...extra, seeded };
  }

  it('pagina por cursor sem repetir nem pular, só com eventos publicados e futuros', async () => {
    const { tiedA, tiedB, later, draft, past, seeded } = await populate();
    const expected = [...seeded, tiedA, tiedB, later]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((event) => event.id);

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: '2' });
      if (cursor) {
        query.set('cursor', cursor);
      }
      const response = await call(api.url, `/events?${query.toString()}`);
      expect(response.status).toBe(200);
      const page = await json<Page<EventSummaryResponse>>(response);
      expect(page.items.every((item) => item.status === 'PUBLISHED')).toBe(true);
      pageSizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null && pageSizes.length < 10);

    expect(pageSizes).toEqual([2, 2, 1]);
    expect(seen).toEqual(expected);
    expect(seen).not.toContain(draft.id);
    expect(seen).not.toContain(past.id);
  });

  it('filtra pelo intervalo [from, to) da data do evento', async () => {
    const { tiedA, tiedB, past, seeded } = await populate();
    const inThirtyDays = seeded.find((event) => event.startsAt > inDays(25));

    const window = await publicIds({
      from: inDays(15).toISOString(),
      to: inDays(31).toISOString(),
    });
    expect(window.toSorted()).toEqual([tiedA.id, tiedB.id, inThirtyDays?.id].toSorted());

    // Com `from` no passado, eventos que já aconteceram também aparecem.
    expect(
      await publicIds({ from: inDays(-2).toISOString(), to: inDays(0).toISOString() }),
    ).toEqual([past.id]);
  });

  it('cursor adulterado responde 400', async () => {
    const response = await call(api.url, '/events?cursor=adulterado');
    expect(response.status).toBe(400);
    expect(await json<ErrorResponse>(response)).toMatchObject({ issues: [{ path: 'cursor' }] });
  });
});

describe('lotes e estoque', () => {
  it('reduzir o total abaixo do vendido responde 409 e não mexe no estoque', async () => {
    const jar = await loginAs(ORGANIZER);
    const event = await createEvent(jar);
    const ticketType = await createTicketType(jar, event.id, { total: 10 });
    // 7 vendidos ou reservados (os pedidos só chegam na etapa 3.2).
    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { available: 3 } });
    const path = `/events/${event.id}/ticket-types/${ticketType.id}`;

    const belowSold = await call(api.url, path, { method: 'PATCH', body: { total: 6 }, jar });
    expect(belowSold.status).toBe(409);
    expect(await errorCode(belowSold)).toBe('TICKET_TYPE_TOTAL_BELOW_SOLD');
    expect(
      await prisma.ticketType.findUniqueOrThrow({
        where: { id: ticketType.id },
        select: { total: true, available: true },
      }),
    ).toEqual({ total: 10, available: 3 });

    const exactlySold = await call(api.url, path, { method: 'PATCH', body: { total: 7 }, jar });
    expect(exactlySold.status).toBe(200);
    expect(await json<TicketTypeResponse>(exactlySold)).toMatchObject({ total: 7, available: 0 });

    const increased = await call(api.url, path, { method: 'PATCH', body: { total: 12 }, jar });
    expect(await json<TicketTypeResponse>(increased)).toMatchObject({ total: 12, available: 5 });
  });

  it('lote não pode vender depois do início do evento (422)', async () => {
    const jar = await loginAs(ORGANIZER);
    const event = await createEvent(jar, { startsAt: inDays(60).toISOString() });
    const ticketType = await createTicketType(jar, event.id, {
      salesEnd: inDays(30).toISOString(),
    });

    const responses = {
      newLotAfterEvent: await call(api.url, `/events/${event.id}/ticket-types`, {
        method: 'POST',
        body: ticketTypeBody({ salesEnd: inDays(61).toISOString() }),
        jar,
      }),
      lotEndAfterEvent: await call(api.url, `/events/${event.id}/ticket-types/${ticketType.id}`, {
        method: 'PATCH',
        body: { salesEnd: inDays(61).toISOString() },
        jar,
      }),
      lotStartAfterEnd: await call(api.url, `/events/${event.id}/ticket-types/${ticketType.id}`, {
        method: 'PATCH',
        body: { salesStart: inDays(31).toISOString() },
        jar,
      }),
      eventBeforeSalesEnd: await call(api.url, `/events/${event.id}`, {
        method: 'PATCH',
        body: { startsAt: inDays(29).toISOString() },
        jar,
      }),
    };
    for (const response of Object.values(responses)) {
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('INVALID_SALES_WINDOW');
    }

    const past = await call(api.url, `/events/${event.id}`, {
      method: 'PATCH',
      body: { startsAt: inDays(-1).toISOString() },
      jar,
    });
    expect(past.status).toBe(422);
    expect(await errorCode(past)).toBe('EVENT_IN_PAST');

    const moved = await call(api.url, `/events/${event.id}`, {
      method: 'PATCH',
      body: { startsAt: inDays(31).toISOString() },
      jar,
    });
    expect(moved.status).toBe(200);
  });

  it('mudar a data do evento e o fim das vendas ao mesmo tempo nunca deixa o lote incoerente', async () => {
    // Cada mudança sozinha é válida; as duas juntas deixariam o lote vendendo depois do
    // início do evento. A trava do evento serializa as duas: exatamente uma passa.
    const jar = await loginAs(ORGANIZER);
    const event = await createEvent(jar, { startsAt: inDays(60).toISOString() });
    const ticketType = await createTicketType(jar, event.id, {
      salesEnd: inDays(30).toISOString(),
    });

    for (let round = 0; round < 5; round += 1) {
      await prisma.event.update({ where: { id: event.id }, data: { startsAt: inDays(60) } });
      await prisma.ticketType.update({
        where: { id: ticketType.id },
        data: { salesEnd: inDays(30) },
      });

      const [moveEvent, extendSales] = await Promise.all([
        call(api.url, `/events/${event.id}`, {
          method: 'PATCH',
          body: { startsAt: inDays(40).toISOString() },
          jar,
        }),
        call(api.url, `/events/${event.id}/ticket-types/${ticketType.id}`, {
          method: 'PATCH',
          body: { salesEnd: inDays(50).toISOString() },
          jar,
        }),
      ]);

      expect([moveEvent.status, extendSales.status].toSorted()).toEqual([200, 422]);
      const stored = await prisma.event.findUniqueOrThrow({
        where: { id: event.id },
        include: { ticketTypes: true },
      });
      expect(stored.ticketTypes[0]?.salesEnd.getTime()).toBeLessThanOrEqual(
        stored.startsAt.getTime(),
      );
    }
  });
});

describe('publicação, exclusão e evento cancelado', () => {
  it('publicar sem lote responde 409; publicar de novo é idempotente', async () => {
    const jar = await loginAs(ORGANIZER);
    const event = await createEvent(jar);
    const publish = () => call(api.url, `/events/${event.id}/publish`, { method: 'POST', jar });

    const withoutTicketTypes = await publish();
    expect(withoutTicketTypes.status).toBe(409);
    expect(await errorCode(withoutTicketTypes)).toBe('EVENT_WITHOUT_TICKET_TYPES');

    await createTicketType(jar, event.id);
    expect((await publish()).status).toBe(200);
    const again = await publish();
    expect(again.status).toBe(200);
    expect(await json<EventResponse>(again)).toMatchObject({ status: 'PUBLISHED' });
  });

  it('exclui rascunho com os lotes, mas não evento publicado', async () => {
    const jar = await loginAs(ORGANIZER);
    const draft = await createEvent(jar);
    await createTicketType(jar, draft.id);

    const removed = await call(api.url, `/events/${draft.id}`, { method: 'DELETE', jar });
    expect(removed.status).toBe(204);
    expect(await prisma.event.count({ where: { id: draft.id } })).toBe(0);
    expect(await prisma.ticketType.count({ where: { eventId: draft.id } })).toBe(0);

    const published = await createEvent(jar);
    await createTicketType(jar, published.id);
    const publish = await call(api.url, `/events/${published.id}/publish`, {
      method: 'POST',
      jar,
    });
    expect(publish.status).toBe(200);
    const refused = await call(api.url, `/events/${published.id}`, { method: 'DELETE', jar });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('EVENT_NOT_DELETABLE');
  });

  it('evento cancelado não aceita alterações nem novos lotes (409)', async () => {
    const jar = await loginAs(ORGANIZER);
    const event = await createEvent(jar);
    // O cancelamento pela API chega na etapa 5.4.
    await prisma.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });

    const edit = await call(api.url, `/events/${event.id}`, {
      method: 'PATCH',
      body: { title: 'x' },
      jar,
    });
    const newTicketType = await call(api.url, `/events/${event.id}/ticket-types`, {
      method: 'POST',
      body: ticketTypeBody(),
      jar,
    });
    for (const response of [edit, newTicketType]) {
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe('EVENT_NOT_EDITABLE');
    }
    expect((await call(api.url, `/events/${event.id}`)).status).toBe(404);
  });
});
