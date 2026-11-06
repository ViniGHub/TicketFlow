import { Prisma } from '@ticketflow/db';
import {
  type CatalogRepository,
  IdempotencyKeyTakenError,
  type InventoryRepository,
  type NewOrder,
  type Order,
  type OrderRepository,
  type OrderStatus,
  type OrderStatusChanges,
  type OutboxMessage,
  type OutboxRepository,
  type PurchasableTicketType,
  type TicketTypeLabel,
} from '@ticketflow/domain';

import { toDomainOrder, withItems } from '../orders.mapper';

// Implementações Prisma das portas do domínio (packages/domain/src/ports.ts). Cada instância
// fica presa à transação recebida do PrismaUnitOfWork.

type Tx = Prisma.TransactionClient;

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly tx: Tx) {}

  async lockForPurchase(ticketTypeIds: readonly string[]): Promise<PurchasableTicketType[]> {
    const ids = [...ticketTypeIds];
    // FOR SHARE: compras do mesmo evento não se bloqueiam, mas esperam as escritas do
    // organizador (FOR UPDATE em catalog-locks.ts). Em ordem de id, como toda trava.
    await this.tx.$queryRaw`
      SELECT id FROM events
      WHERE id IN (SELECT event_id FROM ticket_types WHERE id = ANY(${ids}::uuid[]))
      ORDER BY id
      FOR SHARE`;
    // Lido depois da trava: enxerga o que o organizador já confirmou.
    return this.tx.ticketType.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        priceCents: true,
        salesStart: true,
        salesEnd: true,
        maxPerOrder: true,
        event: { select: { id: true, status: true } },
      },
    });
  }

  async findLabels(ticketTypeIds: readonly string[]): Promise<TicketTypeLabel[]> {
    const rows = await this.tx.ticketType.findMany({
      where: { id: { in: [...ticketTypeIds] } },
      select: { id: true, name: true, event: { select: { title: true } } },
    });
    return rows.map(({ id, name, event }) => ({ id, name, eventTitle: event.title }));
  }
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly tx: Tx) {}

  /** `UPDATE ... SET available = available - qty WHERE id = ? AND available >= qty`. */
  async tryReserve(ticketTypeId: string, quantity: number): Promise<boolean> {
    const { count } = await this.tx.ticketType.updateMany({
      where: { id: ticketTypeId, available: { gte: quantity } },
      data: { available: { decrement: quantity } },
    });
    return count === 1;
  }

  async release(ticketTypeId: string, quantity: number): Promise<void> {
    await this.tx.ticketType.update({
      where: { id: ticketTypeId },
      data: { available: { increment: quantity } },
    });
  }
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly tx: Tx) {}

  async create(order: NewOrder): Promise<Order> {
    try {
      const row = await this.tx.order.create({
        data: {
          userId: order.userId,
          totalCents: order.totalCents,
          expiresAt: order.expiresAt,
          idempotencyKey: order.idempotencyKey,
          requestHash: order.requestHash,
          items: {
            createMany: {
              data: order.items.map(({ ticketTypeId, quantity, unitPriceCents }) => ({
                ticketTypeId,
                quantity,
                unitPriceCents,
              })),
            },
          },
        },
        include: withItems,
      });
      return toDomainOrder(row);
    } catch (error) {
      // A única UNIQUE que este INSERT pode violar é (user_id, idempotency_key): o id é
      // gerado, o domínio não deixa lote repetido e stripe_session_id ainda é nulo.
      if (
        order.idempotencyKey !== null &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new IdempotencyKeyTakenError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.tx.order.findUnique({ where: { id }, include: withItems });
    return row && toDomainOrder(row);
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Order | null> {
    const row = await this.tx.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: withItems,
    });
    return row && toDomainOrder(row);
  }

  async lockById(id: string): Promise<Order | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    return locked.length === 0 ? null : this.findById(id);
  }

  async lockExpiredPending(now: Date, limit: number): Promise<Order[]> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders
      WHERE status = 'PENDING' AND expires_at < ${now}
      ORDER BY expires_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) {
      return [];
    }
    const rows = await this.tx.order.findMany({
      where: { id: { in: locked.map((row) => row.id) } },
      orderBy: { expiresAt: 'asc' },
      include: withItems,
    });
    return rows.map(toDomainOrder);
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    changes: OrderStatusChanges = {},
  ): Promise<void> {
    await this.tx.order.update({ where: { id }, data: { status, ...changes } });
  }

  async setCheckoutSession(id: string, stripeSessionId: string): Promise<void> {
    await this.tx.order.update({ where: { id }, data: { stripeSessionId } });
  }
}

export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly tx: Tx) {}

  async add({ type, payload }: OutboxMessage): Promise<void> {
    await this.tx.outbox.create({ data: { type, payload } });
  }
}
