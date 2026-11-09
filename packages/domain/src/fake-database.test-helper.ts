// Banco em memória para os testes unitários do domínio. Fica fora do build e da cobertura
// (tsconfig.build.json e vitest.config.ts).
import { type EventStatus } from './catalog.js';
import { type NewOrder, type Order } from './order.js';
import {
  type CheckoutGateway,
  type CheckoutSession,
  type CheckoutSessionRequest,
  type CheckoutSessionState,
  type ExpireCheckoutSessionResult,
  IdempotencyKeyTakenError,
  type NewTicket,
  type OutboxMessage,
  type PurchasableTicketType,
  type SessionExpirer,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';

/** Expira sessões de mentira. Por padrão responde `expired`; erros são lançados. */
export class FakeSessionExpirer implements SessionExpirer {
  calls: string[] = [];
  results = new Map<string, ExpireCheckoutSessionResult | Error>();
  /** Roda a cada chamada (ex.: conferir o que já estava travado nesse momento). */
  onCall?: (sessionId: string) => void;

  expireCheckoutSession(sessionId: string): Promise<ExpireCheckoutSessionResult> {
    this.calls.push(sessionId);
    this.onCall?.(sessionId);
    const result = this.results.get(sessionId) ?? 'expired';
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }
}

/**
 * Gateway de pagamento de mentira para `startCheckout`. Como o Stripe com a chave
 * `order.id`, o mesmo pedido sempre recebe a mesma sessão. Erros configurados são lançados.
 */
export class FakeCheckoutGateway implements CheckoutGateway {
  created: CheckoutSessionRequest[] = [];
  retrieved: string[] = [];
  expired: string[] = [];
  sessions = new Map<string, CheckoutSessionState>();
  createError?: Error;
  retrieveError?: Error;
  expireError?: Error;
  /** Roda a cada chamada, antes de responder (ex.: outra transação muda o pedido). */
  onCall?: (method: 'create' | 'retrieve' | 'expire') => void;

  static sessionIdOf(orderId: string): string {
    return `cs_test_${orderId}`;
  }

  /** Grava uma sessão já existente, como se tivesse sido criada antes. */
  addSession(orderId: string, overrides: Partial<CheckoutSessionState> = {}): CheckoutSessionState {
    const id = FakeCheckoutGateway.sessionIdOf(orderId);
    const session: CheckoutSessionState = {
      id,
      orderId,
      status: 'open',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      url: `https://checkout.stripe.test/${id}`,
      ...overrides,
    };
    this.sessions.set(id, session);
    return session;
  }

  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    this.onCall?.('create');
    this.created.push(request);
    if (this.createError) {
      return Promise.reject(this.createError);
    }
    const session =
      this.sessions.get(FakeCheckoutGateway.sessionIdOf(request.orderId)) ??
      this.addSession(request.orderId);
    return Promise.resolve({ id: session.id, url: session.url ?? '' });
  }

  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState> {
    this.onCall?.('retrieve');
    this.retrieved.push(sessionId);
    const session = this.sessions.get(sessionId);
    if (this.retrieveError || !session) {
      return Promise.reject(this.retrieveError ?? new Error(`Sessão inexistente: ${sessionId}`));
    }
    return Promise.resolve(session);
  }

  expireCheckoutSession(sessionId: string): Promise<ExpireCheckoutSessionResult> {
    this.onCall?.('expire');
    this.expired.push(sessionId);
    if (this.expireError) {
      return Promise.reject(this.expireError);
    }
    const session = this.sessions.get(sessionId);
    if (session?.status === 'complete') {
      return Promise.resolve('complete');
    }
    if (session) {
      session.status = 'expired';
      session.url = null;
    }
    return Promise.resolve('expired');
  }
}

export const FAKE_NOW = new Date('2026-11-20T12:00:00Z');

export interface StoredTicketType extends PurchasableTicketType {
  available: number;
  name: string;
  eventTitle: string;
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
  tickets: NewTicket[] = [];
  /** Anulações de ingressos, por pedido (`voided_at`). */
  ticketVoids: { orderId: string; voidedAt: Date }[] = [];
  outbox: OutboxMessage[] = [];
  /** `stripe_events`: id do evento → tipo. */
  stripeEvents = new Map<string, string>();
  runs = 0;
  /** Transações abertas agora: chamadas ao gateway precisam acontecer com zero (regra 8). */
  openTransactions = 0;
  /** Simula outra requisição gravando um pedido com a mesma chave antes deste `create`. */
  beforeCreate?: (order: NewOrder) => void;
  /** Roda uma vez, antes da primeira reserva (ex.: outra compra leva o estoque). */
  beforeReserve?: () => void;
  /** Roda uma vez, antes de travar um pedido (ex.: outra transação muda o status). */
  beforeLock?: (orderId: string) => void;
  /** Roda antes de cada gravação na outbox (ex.: lançar erro no meio do processamento). */
  beforeOutboxAdd?: (message: OutboxMessage) => void;

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
      name: 'Pista',
      eventTitle: 'Show de Teste',
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

  /**
   * Outra transação, já confirmada, muda o pedido: altera o objeto no lugar, então a mudança
   * sobrevive ao rollback desta (o snapshot guarda as mesmas referências).
   */
  commitElsewhere(id: string, change: Partial<Order>): void {
    const order = this.orders.find((stored) => stored.id === id);
    if (order) {
      Object.assign(order, change);
    }
  }

  available(id: string): number | undefined {
    return this.ticketTypes.get(id)?.available;
  }

  order(id: string): Order | undefined {
    return this.allOrders().find((order) => order.id === id);
  }

  async run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    this.runs += 1;
    this.openTransactions += 1;
    const snapshot = {
      ticketTypes: new Map([...this.ticketTypes].map(([id, lot]) => [id, { ...lot }])),
      orders: [...this.orders],
      tickets: [...this.tickets],
      ticketVoids: [...this.ticketVoids],
      outbox: [...this.outbox],
      stripeEvents: new Map(this.stripeEvents),
    };
    try {
      return await work(this.repositories());
    } catch (error) {
      this.ticketTypes = snapshot.ticketTypes;
      this.orders = snapshot.orders;
      this.tickets = snapshot.tickets;
      this.ticketVoids = snapshot.ticketVoids;
      this.outbox = snapshot.outbox;
      this.stripeEvents = snapshot.stripeEvents;
      throw error;
    } finally {
      this.openTransactions -= 1;
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
    return {
      catalog: {
        lockForPurchase: (ids) =>
          Promise.resolve(
            ids.flatMap((id) => {
              const lot = this.ticketTypes.get(id);
              return lot ? [lot] : [];
            }),
          ),
        findLabels: (ids) =>
          Promise.resolve(
            ids.flatMap((id) => {
              const lot = this.ticketTypes.get(id);
              return lot ? [{ id, name: lot.name, eventTitle: lot.eventTitle }] : [];
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
        lockByPaymentIntent: (paymentIntentId) => {
          const order = this.allOrders().find(
            (stored) => stored.stripePaymentIntentId === paymentIntentId,
          );
          if (order) {
            this.locks.push(order.id);
          }
          return Promise.resolve(order ?? null);
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
      outbox: {
        add: (message) => {
          this.beforeOutboxAdd?.(message);
          this.outbox.push(message);
          return Promise.resolve();
        },
      },
      tickets: {
        createMany: (tickets) => {
          this.tickets.push(...tickets);
          return Promise.resolve();
        },
        voidByOrder: (orderId, voidedAt) => {
          this.ticketVoids.push({ orderId, voidedAt });
          return Promise.resolve(
            this.tickets.filter((ticket) => ticket.orderId === orderId).length,
          );
        },
      },
      stripeEvents: {
        record: (eventId, type) => {
          if (this.stripeEvents.has(eventId)) {
            return Promise.resolve(false);
          }
          this.stripeEvents.set(eventId, type);
          return Promise.resolve(true);
        },
      },
    };
  }
}
