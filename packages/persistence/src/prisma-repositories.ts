import { Prisma } from '@ticketflow/db';
import {
  type CatalogRepository,
  type EventStatus,
  IdempotencyKeyTakenError,
  type InventoryRepository,
  type LockedEvent,
  type NewOrder,
  type NewTicket,
  type Order,
  type OrderRepository,
  type OrderStatus,
  type OrderStatusChanges,
  type OutboxMessage,
  type OutboxRepository,
  type PurchasableTicketType,
  type StripeEventRepository,
  type TicketRepository,
  type TicketTypeLabel,
} from '@ticketflow/domain';

import { toDomainOrder, withItems } from './order-mapping.js';

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

  async lockOwnedEvent(eventId: string, organizerId: string): Promise<LockedEvent | null> {
    // A mesma trava das escritas do catálogo na API (catalog-locks.ts).
    const [event] = await this.tx.$queryRaw<{ id: string; status: EventStatus }[]>`
      SELECT id, status::text AS status
      FROM events
      WHERE id = ${eventId}::uuid AND organizer_id = ${organizerId}::uuid
      FOR UPDATE`;
    return event ?? null;
  }

  async markEventCancelled(eventId: string, cancelledAt: Date): Promise<void> {
    await this.tx.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED', cancelledAt },
    });
  }

  async findEventStatuses(ticketTypeIds: readonly string[]): Promise<EventStatus[]> {
    const events = await this.tx.event.findMany({
      where: { ticketTypes: { some: { id: { in: [...ticketTypeIds] } } } },
      select: { status: true },
    });
    return [...new Set(events.map((event) => event.status))];
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

  async lockByPaymentIntent(paymentIntentId: string): Promise<Order | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE stripe_payment_intent_id = ${paymentIntentId} FOR UPDATE`;
    const [row] = locked;
    return row ? this.findById(row.id) : null;
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

  async lockActiveByEvent(eventId: string): Promise<Order[]> {
    // Só as linhas de orders ficam travadas; o EXISTS lê os itens e os lotes sem trava.
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM orders o
      WHERE o.status IN ('PENDING', 'PROCESSING', 'PAID')
        AND EXISTS (
          SELECT 1 FROM order_items i
          JOIN ticket_types t ON t.id = i.ticket_type_id
          WHERE i.order_id = o.id AND t.event_id = ${eventId}::uuid
        )
      ORDER BY o.id
      FOR UPDATE`;
    if (locked.length === 0) {
      return [];
    }
    const rows = await this.tx.order.findMany({
      where: { id: { in: locked.map((row) => row.id) } },
      orderBy: { id: 'asc' },
      include: withItems,
    });
    return rows.map(toDomainOrder);
  }

  async endReservation(id: string, at: Date): Promise<void> {
    await this.tx.order.updateMany({
      where: { id, expiresAt: { gt: at } },
      data: { expiresAt: at },
    });
  }

  async findAwaitingPayment(createdBefore: Date, limit: number): Promise<Order[]> {
    const rows = await this.tx.order.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        stripeSessionId: { not: null },
        createdAt: { lt: createdBefore },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
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

export class PrismaTicketRepository implements TicketRepository {
  constructor(private readonly tx: Tx) {}

  async createMany(tickets: readonly NewTicket[]): Promise<void> {
    if (tickets.length === 0) {
      return;
    }
    // event_id é desnormalizado para o check-in atômico (seção 9): vem do lote de cada ticket.
    const lots = await this.tx.ticketType.findMany({
      where: { id: { in: [...new Set(tickets.map((ticket) => ticket.ticketTypeId))] } },
      select: { id: true, eventId: true },
    });
    const eventOf = new Map(lots.map((lot) => [lot.id, lot.eventId]));
    await this.tx.ticket.createMany({
      data: tickets.map(({ orderId, ticketTypeId, qrToken }) => {
        const eventId = eventOf.get(ticketTypeId);
        // order_items referencia o lote com ON DELETE RESTRICT: faltar aqui é dado corrompido.
        if (!eventId) {
          throw new Error(`O lote ${ticketTypeId} do pedido ${orderId} não existe.`);
        }
        return { orderId, ticketTypeId, eventId, qrToken };
      }),
    });
  }

  async voidByOrder(orderId: string, voidedAt: Date): Promise<number> {
    const { count } = await this.tx.ticket.updateMany({
      where: { orderId, voidedAt: null },
      data: { voidedAt },
    });
    return count;
  }
}

export class PrismaStripeEventRepository implements StripeEventRepository {
  constructor(private readonly tx: Tx) {}

  /**
   * `ON CONFLICT DO NOTHING` em vez de deixar a PK falhar: no Postgres, um erro aborta a
   * transação inteira. Com outra transação gravando o mesmo evento, o INSERT espera por ela:
   * se ela confirmar, conta 0 (repetido); se ela desfizer, esta grava e processa.
   */
  async record(eventId: string, type: string): Promise<boolean> {
    const inserted = await this.tx.$executeRaw`
      INSERT INTO stripe_events (event_id, type) VALUES (${eventId}, ${type})
      ON CONFLICT (event_id) DO NOTHING`;
    return inserted === 1;
  }
}
