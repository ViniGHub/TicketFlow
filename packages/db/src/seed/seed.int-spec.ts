import { truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { EventStatus } from '../generated/prisma/client.js';
import { createPrismaClient } from '../index.js';

import { seed, SEED_EVENTS, SEED_USERS } from './seed.js';

const databaseUrl = inject('databaseUrl');
const prisma = createPrismaClient(databaseUrl);

const expectedTicketTypes = SEED_EVENTS.flatMap((event) => event.ticketTypes).length;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
});

describe('seed', () => {
  it('cria os usuários, eventos publicados e lotes com a janela de vendas aberta', async () => {
    const now = new Date();
    await seed(prisma, now);

    const users = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    expect(users.map((user) => user.email).sort()).toEqual(
      SEED_USERS.map((user) => user.email).sort(),
    );
    expect(users.find((user) => user.email === 'ambos@ticketflow.local')?.roles).toEqual([
      'BUYER',
      'ORGANIZER',
    ]);
    for (const user of users) {
      expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    }

    const events = await prisma.event.findMany({ include: { ticketTypes: true } });
    expect(events).toHaveLength(SEED_EVENTS.length);
    for (const event of events) {
      expect(event.status).toBe(EventStatus.PUBLISHED);
      expect(event.startsAt.getTime()).toBeGreaterThan(now.getTime());
      for (const ticketType of event.ticketTypes) {
        expect(ticketType.available).toBe(ticketType.total);
        expect(ticketType.salesStart.getTime()).toBeLessThan(now.getTime());
        expect(ticketType.salesEnd.getTime()).toBeGreaterThan(now.getTime());
        expect(ticketType.salesEnd.getTime()).toBeLessThanOrEqual(event.startsAt.getTime());
      }
    }
  });

  it('é idempotente: rodar de novo não duplica, não troca senhas nem mexe no estoque', async () => {
    await seed(prisma);
    const before = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    const ticketTypeId = SEED_EVENTS[0]?.ticketTypes[0]?.id as string;
    // Simula uma venda entre as duas execuções.
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { available: { decrement: 3 } },
    });

    const result = await seed(prisma);

    expect(result).toEqual({
      users: SEED_USERS.length,
      events: SEED_EVENTS.length,
      ticketTypes: expectedTicketTypes,
    });
    expect(await prisma.user.count()).toBe(SEED_USERS.length);
    expect(await prisma.event.count()).toBe(SEED_EVENTS.length);
    expect(await prisma.ticketType.count()).toBe(expectedTicketTypes);

    const after = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    expect(after.map((user) => user.passwordHash)).toEqual(before.map((user) => user.passwordHash));

    const ticketType = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(ticketType.available).toBe(ticketType.total - 3);
  });
});
