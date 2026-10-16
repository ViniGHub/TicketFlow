import { EventStatus, type PrismaClient, Role } from '../generated/prisma/client.js';

import { DEV_PASSWORD, hashPasswordForSeed } from './dev-password.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Usuários do seed (todos com a senha DEV_PASSWORD). */
export const SEED_USERS = [
  {
    email: 'organizador@ticketflow.local',
    name: 'Olívia Organizadora',
    roles: [Role.ORGANIZER],
  },
  { email: 'comprador@ticketflow.local', name: 'Caio Comprador', roles: [Role.BUYER] },
  {
    email: 'ambos@ticketflow.local',
    name: 'Ana Compradora e Organizadora',
    roles: [Role.BUYER, Role.ORGANIZER],
  },
] as const;

interface SeedTicketType {
  id: string;
  name: string;
  priceCents: number;
  total: number;
  maxPerOrder: number;
}

interface SeedEvent {
  id: string;
  organizerEmail: string;
  title: string;
  description: string;
  venue: string;
  timezone: string;
  /** Dias a partir da execução do seed. */
  startsInDays: number;
  ticketTypes: SeedTicketType[];
}

// IDs fixos: o seed faz upsert por id e pode rodar várias vezes sem duplicar nada.
export const SEED_EVENTS: SeedEvent[] = [
  {
    id: '019a0000-0000-7000-8000-000000000001',
    organizerEmail: 'organizador@ticketflow.local',
    title: 'Jazz no Parque',
    description: 'Noite de jazz ao ar livre com bandas locais.',
    venue: 'Parque Ibirapuera, São Paulo',
    timezone: 'America/Sao_Paulo',
    startsInDays: 30,
    ticketTypes: [
      {
        id: '019a0000-0000-7000-8000-000000000101',
        name: 'Pista',
        priceCents: 8_000,
        total: 100,
        maxPerOrder: 4,
      },
      {
        id: '019a0000-0000-7000-8000-000000000102',
        name: 'Meia-entrada',
        priceCents: 4_000,
        total: 50,
        maxPerOrder: 2,
      },
    ],
  },
  {
    id: '019a0000-0000-7000-8000-000000000002',
    organizerEmail: 'ambos@ticketflow.local',
    title: 'Workshop de TypeScript',
    description: 'Tarde prática sobre tipos avançados. Vagas limitadas.',
    venue: 'Porto Digital, Recife',
    timezone: 'America/Recife',
    startsInDays: 14,
    ticketTypes: [
      {
        id: '019a0000-0000-7000-8000-000000000201',
        name: 'Ingresso único',
        priceCents: 15_000,
        total: 10,
        maxPerOrder: 2,
      },
    ],
  },
];

export interface SeedResult {
  users: number;
  events: number;
  ticketTypes: number;
}

/**
 * Popula o banco com dados de desenvolvimento. Idempotente: rodar de novo não duplica
 * registros, não troca senhas e não mexe no estoque (`total`/`available`) de lotes que já
 * existem; só renova as datas, para a janela de vendas continuar aberta.
 */
export async function seed(prisma: PrismaClient, now: Date = new Date()): Promise<SeedResult> {
  return prisma.$transaction(async (tx) => {
    const userIds = new Map<string, string>();
    for (const user of SEED_USERS) {
      const { id } = await tx.user.upsert({
        where: { email: user.email },
        create: {
          email: user.email,
          name: user.name,
          roles: [...user.roles],
          passwordHash: hashPasswordForSeed(DEV_PASSWORD),
        },
        update: { name: user.name, roles: [...user.roles] },
        select: { id: true },
      });
      userIds.set(user.email, id);
    }

    let ticketTypes = 0;
    for (const event of SEED_EVENTS) {
      const organizerId = userIds.get(event.organizerEmail);
      if (!organizerId) {
        throw new Error(`Organizador do seed não encontrado: ${event.organizerEmail}`);
      }
      const startsAt = new Date(now.getTime() + event.startsInDays * DAY_MS);
      const details = {
        title: event.title,
        description: event.description,
        venue: event.venue,
        timezone: event.timezone,
        startsAt,
        status: EventStatus.PUBLISHED,
      };
      await tx.event.upsert({
        where: { id: event.id },
        create: { id: event.id, organizerId, ...details },
        update: details,
      });

      const salesWindow = {
        salesStart: new Date(now.getTime() - DAY_MS),
        salesEnd: new Date(startsAt.getTime() - HOUR_MS),
      };
      for (const ticketType of event.ticketTypes) {
        const { id, total, ...rest } = ticketType;
        await tx.ticketType.upsert({
          where: { id },
          create: { id, eventId: event.id, total, available: total, ...rest, ...salesWindow },
          update: { ...rest, ...salesWindow },
        });
        ticketTypes += 1;
      }
    }

    return { users: SEED_USERS.length, events: SEED_EVENTS.length, ticketTypes };
  });
}
