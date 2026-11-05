// Banco em memória para os testes unitários do domínio. Fica fora do build e da cobertura
// (tsconfig.build.json e vitest.config.ts).
import { type EventStatus } from './catalog.js';
import { type NewOrder, type Order } from './order.js';
import {
  IdempotencyKeyTakenError,
  type PurchasableTicketType,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';

export const FAKE_NOW = new Date('2026-11-20T12:00:00Z');

export interface StoredTicketType extends PurchasableTicketType {
  available: number;
}

/**
 * Unidade de trabalho de mentira: `run` copia o estado e o restaura se o trabalho lançar erro,
 * como o rollback do Postgres. Registra reservas, devoluções e travas na ordem em que
 * acontecem, e tem ganchos para simular outra transação agindo no meio desta.
 */
export class FakeDatabase implements UnitOfWork {
  ticketTypes = new Map<string, StoredTicketType>();
  orders: Order[] = [];
  /** Pedidos confirmados por outra transação: o rollback desta não os desfaz. */
  committedElsewhere: Order[] = [];
  reservations: string[] = [];
  releases: { ticketTypeId: string; quantity: number }[] = [];
  locks: string[] = [];
  runs = 0;
  /** Simula outra requisição gravando um pedido com a mesma chave antes deste `create`. */
  beforeCreate?: (order: NewOrder) => void;
  /** Roda uma vez, antes da primeira reserva (ex.: outra compra leva o estoque). */
  beforeReserve?: () => void;
  /** Roda uma vez, antes de travar um pedido (ex.: outra transação muda o status). */
  beforeLock?: (orderId: string) => void;

  addTicketType(
    id: string,
    overrides: Partial<Omit<StoredTicketType, 'event'>> & { status?: EventStatus } = {},
  ): void {
    const { status = 'PUBLISHED', ...rest } = overrides;
    this.ticketTypes.set(id, {
      id,
      priceCents: 8_000,
      salesStart: new Date('2026-11-01T00:00:00Z'),
      salesEnd: new Date('2026-12-01T00:00:00Z'),
      maxPerOrder: 4,
      available: 10,
      event: { id: 'evento-1', status },
      ...rest,
    });
  }

  /** Grava um pedido já existente (ex.: um PENDING vencido para a expiração). */
  addOrder(id: string, overrides: Partial<Order> = {}): Order {
    const order = this.toOrder(
      {
        userId: 'comprador-1',
        items: [],
        totalCents: 0,
        expiresAt: new Date(FAKE_NOW.getTime() - 60_000),
        idempotencyKey: null,
        requestHash: null,
      },
      id,
    );
    const stored = { ...order, ...overrides };
    this.orders.push(stored);
    return stored;
  }

  available(id: string): number | undefined {
    return this.ticketTypes.get(id)?.available;
  }

  order(id: string): Order | undefined {
    return this.allOrders().find((order) => order.id === id);
  }

  async run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    this.runs += 1;
    const snapshot = {
      ticketTypes: new Map([...this.ticketTypes].map(([id, lot]) => [id, { ...lot }])),
      orders: [...this.orders],
    };
    try {
      return await work(this.repositories());
    } catch (error) {
      this.ticketTypes = snapshot.ticketTypes;
      this.orders = snapshot.orders;
      throw error;
    }
  }

  toOrder(newOrder: NewOrder, id: string): Order {
    return {
      ...newOrder,
      id,
      status: 'PENDING',
      currency: 'BRL',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      paidAt: null,
      createdAt: FAKE_NOW,
    };
  }

  private allOrders(): Order[] {
    return [...this.orders, ...this.committedElsewhere];
  }

  private replaceOrder(id: string, change: Partial<Order>): void {
    this.orders = this.orders.map((order) => (order.id === id ? { ...order, ...change } : order));
  }

  private repositories(): TransactionalRepositories {
    const nothing = () => Promise.resolve(undefined);
    return {
      catalog: {
        lockForPurchase: (ids) =>
          Promise.resolve(
            ids.flatMap((id) => {
              const lot = this.ticketTypes.get(id);
              return lot ? [lot] : [];
            }),
          ),
      },
      inventory: {
        tryReserve: (id, quantity) => {
          const hook = this.beforeReserve;
          this.beforeReserve = undefined;
          hook?.();
          this.reservations.push(id);
          const lot = this.ticketTypes.get(id);
          if (!lot || lot.available < quantity) {
            return Promise.resolve(false);
          }
          lot.available -= quantity;
          return Promise.resolve(true);
        },
        release: (id, quantity) => {
          this.releases.push({ ticketTypeId: id, quantity });
          const lot = this.ticketTypes.get(id);
          if (lot) {
            lot.available += quantity;
          }
          return Promise.resolve();
        },
      },
      orders: {
        create: (newOrder) => {
          this.beforeCreate?.(newOrder);
          this.beforeCreate = undefined;
          const taken = this.allOrders().some(
            (order) =>
              newOrder.idempotencyKey !== null &&
              order.userId === newOrder.userId &&
              order.idempotencyKey === newOrder.idempotencyKey,
          );
          if (taken) {
            return Promise.reject(new IdempotencyKeyTakenError());
          }
          const order = this.toOrder(newOrder, `pedido-${this.orders.length + 1}`);
          this.orders.push(order);
          return Promise.resolve(order);
        },
        findByIdempotencyKey: (userId, key) =>
          Promise.resolve(
            this.allOrders().find(
              (order) => order.userId === userId && order.idempotencyKey === key,
            ) ?? null,
          ),
        findById: (id) => Promise.resolve(this.order(id) ?? null),
        lockById: (id) => {
          const hook = this.beforeLock;
          this.beforeLock = undefined;
          hook?.(id);
          this.locks.push(id);
          return Promise.resolve(this.order(id) ?? null);
        },
        lockExpiredPending: (now, limit) =>
          Promise.resolve(
            this.orders
              .filter((order) => order.status === 'PENDING' && order.expiresAt < now)
              .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
              .slice(0, limit),
          ),
        updateStatus: (id, status, changes = {}) => {
          this.replaceOrder(id, { status, ...changes });
          return Promise.resolve();
        },
        setCheckoutSession: (id, stripeSessionId) => {
          this.replaceOrder(id, { stripeSessionId });
          return Promise.resolve();
        },
      },
      outbox: { add: nothing },
    };
  }
}
