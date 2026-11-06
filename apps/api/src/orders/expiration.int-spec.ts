import { createPrismaClient } from '@ticketflow/db';
import { ExpirationService, type Order } from '@ticketflow/domain';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { fixtures, fromNow } from '../../test/fixtures';

import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';

// ExpirationService (packages/domain) contra o Postgres real, com os repositórios Prisma da
// API. O job que o chama a cada minuto é da etapa 5.3. Os pedidos daqui não têm sessão no
// Stripe: o fake só está lá para a assinatura.

const databaseUrl = inject('databaseUrl');
const prisma = createPrismaClient(databaseUrl);
const { createUser, createEvent, createLot, createOrder, availableOf } = fixtures(prisma);
const expiration = new ExpirationService(new PrismaUnitOfWork(prisma), new FakePaymentGateway());

const MINUTE_MS = 60_000;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
});

async function setup(total: number) {
  const buyerId = await createUser(['BUYER']);
  const event = await createEvent();
  const lot = await createLot(event.id, { total, maxPerOrder: 4 });
  return { buyerId, lot };
}

/** Pedido criado pelo caso de uso e depois vencido há `minutesAgo` minutos. */
async function expiredOrder(
  buyerId: string,
  ticketTypeId: string,
  quantity = 1,
  minutesAgo = 1,
): Promise<Order> {
  const order = await createOrder(buyerId, [{ ticketTypeId, quantity }]);
  await prisma.order.update({
    where: { id: order.id },
    data: { expiresAt: fromNow(-minutesAgo * MINUTE_MS) },
  });
  return order;
}

async function statusOf(orderId: string): Promise<string> {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

describe('expiração de pedidos', () => {
  it('expirar duas vezes devolve o estoque uma vez só', async () => {
    const { buyerId, lot } = await setup(10);
    const orders = [
      await expiredOrder(buyerId, lot.id, 2),
      await expiredOrder(buyerId, lot.id, 2),
      await expiredOrder(buyerId, lot.id, 2),
    ];
    expect(await availableOf(lot.id)).toBe(4);

    const first = await expiration.expireDue(new Date());
    const second = await expiration.expireDue(new Date());

    expect(first.expired.sort()).toEqual(orders.map((order) => order.id).sort());
    expect(second).toEqual({ expired: [], alreadyHandled: [], paymentCompleted: [], failed: [] });
    expect(await availableOf(lot.id)).toBe(10);
    for (const order of orders) {
      expect(await statusOf(order.id)).toBe('EXPIRED');
    }
  });

  it('três execuções simultâneas sobre 20 pedidos devolvem cada um uma vez, em 5 rodadas', async () => {
    const { buyerId, lot } = await setup(40);

    for (let round = 1; round <= 5; round += 1) {
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.ticketType.update({ where: { id: lot.id }, data: { available: 40 } });
      for (let index = 0; index < 20; index += 1) {
        await createOrder(buyerId, [{ ticketTypeId: lot.id, quantity: 1 }]);
      }
      await prisma.order.updateMany({ data: { expiresAt: fromNow(-MINUTE_MS) } });
      expect(await availableOf(lot.id)).toBe(20);

      const now = new Date();
      const summaries = await Promise.all([
        expiration.expireDue(now),
        expiration.expireDue(now),
        expiration.expireDue(now),
      ]);

      const expired = summaries.flatMap((summary) => summary.expired);
      expect({ round, expired: expired.length, unique: new Set(expired).size }).toEqual({
        round,
        expired: 20,
        unique: 20,
      });
      expect(summaries.flatMap((summary) => summary.failed)).toEqual([]);
      expect(await availableOf(lot.id)).toBe(40);
      expect(await prisma.order.count({ where: { status: 'EXPIRED' } })).toBe(20);
    }
  }, 120_000);

  it('só expira PENDING vencidos', async () => {
    const { buyerId, lot } = await setup(10);
    const due = await expiredOrder(buyerId, lot.id);
    const fresh = await createOrder(buyerId, [{ ticketTypeId: lot.id, quantity: 1 }]);
    const processing = await expiredOrder(buyerId, lot.id);
    const paid = await expiredOrder(buyerId, lot.id);
    await prisma.order.update({ where: { id: processing.id }, data: { status: 'PROCESSING' } });
    await prisma.order.update({ where: { id: paid.id }, data: { status: 'PAID' } });

    const summary = await expiration.expireDue(new Date());

    expect(summary.expired).toEqual([due.id]);
    expect(await statusOf(fresh.id)).toBe('PENDING');
    expect(await statusOf(processing.id)).toBe('PROCESSING');
    expect(await statusOf(paid.id)).toBe('PAID');
    expect(await availableOf(lot.id)).toBe(7);
  });

  it('respeita o tamanho do lote, começando pelos que venceram antes', async () => {
    const { buyerId, lot } = await setup(10);
    const recent = await expiredOrder(buyerId, lot.id, 1, 1);
    const oldest = await expiredOrder(buyerId, lot.id, 1, 30);
    const middle = await expiredOrder(buyerId, lot.id, 1, 10);

    const summary = await expiration.expireDue(new Date(), 2);

    expect(summary.expired).toEqual([oldest.id, middle.id]);
    expect(await statusOf(recent.id)).toBe('PENDING');
    expect(await availableOf(lot.id)).toBe(9);
  });
});
