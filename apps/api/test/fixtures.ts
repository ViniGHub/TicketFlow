// Dados dos testes de integração, gravados direto no banco (sem passar pela API).
import { type Role } from '@ticketflow/contracts';
import { type PrismaClient } from '@ticketflow/db';
import { type Order, placeOrder } from '@ticketflow/domain';

import { PrismaUnitOfWork } from '../src/orders/persistence/prisma-unit-of-work';

import { type CookieJar, sessionFor } from './app';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const fromNow = (ms: number) => new Date(Date.now() + ms);

export interface LotOptions {
  priceCents?: number;
  total?: number;
  maxPerOrder?: number;
  salesStart?: Date;
  salesEnd?: Date;
}

export interface OrderItemInput {
  ticketTypeId: string;
  quantity: number;
}

export function fixtures(prisma: PrismaClient) {
  let userCount = 0;

  /** Usuário sem senha utilizável: a sessão vem de `sessionFor`. */
  async function createUser(roles: Role[]): Promise<string> {
    userCount += 1;
    const { id } = await prisma.user.create({
      data: { email: `usuario-${userCount}@teste.local`, name: 'Teste', passwordHash: '-', roles },
    });
    return id;
  }

  async function createBuyer(): Promise<{ id: string; jar: CookieJar }> {
    const id = await createUser(['BUYER']);
    return { id, jar: await sessionFor(id, ['BUYER']) };
  }

  async function createEvent(status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' = 'PUBLISHED') {
    return prisma.event.create({
      data: {
        organizerId: await createUser(['ORGANIZER']),
        title: 'Show de Teste',
        description: '',
        venue: 'Teatro Municipal',
        timezone: 'America/Sao_Paulo',
        startsAt: fromNow(30 * DAY_MS),
        status,
      },
    });
  }

  async function createLot(eventId: string, options: LotOptions = {}) {
    const total = options.total ?? 10;
    return prisma.ticketType.create({
      data: {
        eventId,
        name: 'Pista',
        priceCents: options.priceCents ?? 8_000,
        total,
        available: total,
        maxPerOrder: options.maxPerOrder ?? 4,
        salesStart: options.salesStart ?? fromNow(-DAY_MS),
        salesEnd: options.salesEnd ?? fromNow(10 * DAY_MS),
      },
    });
  }

  /** Pedido PENDING criado pelo caso de uso, com o estoque reservado como no POST /orders. */
  async function createOrder(userId: string, items: OrderItemInput[]): Promise<Order> {
    const { order } = await placeOrder(
      new PrismaUnitOfWork(prisma),
      { userId, items },
      { now: new Date(), reservationTtlMinutes: 30 },
    );
    return order;
  }

  async function availableOf(ticketTypeId: string): Promise<number> {
    const lot = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    return lot.available;
  }

  return { createUser, createBuyer, createEvent, createLot, createOrder, availableOf };
}
