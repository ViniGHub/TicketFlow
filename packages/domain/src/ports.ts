import type { EventStatus } from './catalog.js';
import type { Cents } from './money.js';
import type { NewOrder, Order } from './order.js';
import type { OrderStatus } from './order-status.js';

// Portas do domínio do pedido (ADR 0005): o que o domínio precisa da infraestrutura, sem
// depender de Prisma, BullMQ ou Stripe. As implementações ficam na API e no worker, a partir
// da etapa 3.2; as assinaturas podem ser ajustadas quando forem implementadas.

/**
 * Executa `work` numa única transação de banco, com os repositórios ligados a ela: ou tudo é
 * gravado, ou nada (CLAUDE.md, regras 5 e 7). Nenhuma chamada externa (Stripe, e-mail) pode
 * acontecer dentro de `work` (regra 8).
 */
export interface UnitOfWork {
  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T>;
}

export interface TransactionalRepositories {
  catalog: CatalogRepository;
  orders: OrderRepository;
  inventory: InventoryRepository;
  outbox: OutboxRepository;
}

/** Lote como a compra precisa dele: preço, janela de vendas, limite e o evento. */
export interface PurchasableTicketType {
  id: string;
  priceCents: Cents;
  salesStart: Date;
  salesEnd: Date;
  maxPerOrder: number;
  event: { id: string; status: EventStatus };
}

export interface CatalogRepository {
  /**
   * Lotes de uma compra, com o evento de cada um. Antes de ler os lotes, trava os eventos em
   * modo compartilhado (`FOR SHARE`, em ordem de id): compras não esperam umas pelas outras,
   * mas esperam as escritas do organizador (`FOR UPDATE`) e são esperadas por elas, então o
   * evento não é cancelado nem a janela muda no meio da compra (ADR 0006). Lote inexistente
   * fica fora do resultado.
   */
  lockForPurchase(ticketTypeIds: readonly string[]): Promise<PurchasableTicketType[]>;
}

/**
 * O usuário já tem um pedido com esta `Idempotency-Key`: outra requisição com a mesma chave
 * gravou primeiro. Sinal interno do `OrderRepository` para `placeOrder`, que tenta de novo e
 * devolve o pedido existente; nunca chega ao cliente.
 */
export class IdempotencyKeyTakenError extends Error {
  constructor() {
    super('Este usuário já tem um pedido com esta Idempotency-Key.');
    this.name = 'IdempotencyKeyTakenError';
  }
}

/** Estoque dos lotes (ARCHITECTURE.md, seção 6). */
export interface InventoryRepository {
  /**
   * Decremento atômico (`available = available - qty WHERE available >= qty`). Devolve `false`
   * se não havia estoque; quem lança `InsufficientStockError` é o domínio. Com vários itens,
   * reserve em ordem de `ticketTypeId` para não causar deadlock.
   */
  tryReserve(ticketTypeId: string, quantity: number): Promise<boolean>;

  /** Devolve estoque. Só junto com a transição de status que manda devolver (`stockEffectOf`). */
  release(ticketTypeId: string, quantity: number): Promise<void>;
}

/** Campos gravados junto com a mudança de status. */
export interface OrderStatusChanges {
  paidAt?: Date;
  stripePaymentIntentId?: string;
}

export interface OrderRepository {
  /** Lança `IdempotencyKeyTakenError` se o usuário já tem pedido com a mesma chave. */
  create(order: NewOrder): Promise<Order>;

  findById(id: string): Promise<Order | null>;

  /** Pedido anterior do mesmo usuário com a mesma `Idempotency-Key` (seção 7). */
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Order | null>;

  /** `SELECT ... FOR UPDATE`: o pedido fica travado até o fim da transação. */
  lockById(id: string): Promise<Order | null>;

  /**
   * Trava até `limit` pedidos `PENDING` com `expires_at < now`, pulando os que outra transação
   * já travou (`FOR UPDATE SKIP LOCKED`). `PROCESSING` nunca entra: ver seção 4.
   */
  lockExpiredPending(now: Date, limit: number): Promise<Order[]>;

  /** Grava o novo status. A transição já foi validada pelo domínio (`assertTransition`). */
  updateStatus(id: string, status: OrderStatus, changes?: OrderStatusChanges): Promise<void>;

  /** Grava o id da Checkout Session criada para o pedido (seção 5, passo 2). */
  setCheckoutSession(id: string, stripeSessionId: string): Promise<void>;
}

/** Valor que cabe numa coluna `jsonb`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface OutboxMessage {
  /** Nome do job no BullMQ, ex. `send-ticket-email`. */
  type: string;
  payload: JsonObject;
}

/**
 * Transactional outbox (seção 7). Grava na mesma transação da mudança de negócio; o relay do
 * worker publica no BullMQ com `jobId = outbox.id`. Ler e marcar como publicado é
 * infraestrutura do relay e não passa pelo domínio.
 */
export interface OutboxRepository {
  add(message: OutboxMessage): Promise<void>;
}

export interface CheckoutLineItem {
  name: string;
  unitPriceCents: Cents;
  quantity: number;
}

export interface CheckoutSessionRequest {
  orderId: string;
  lineItems: readonly CheckoutLineItem[];
  /** Fim da reserva. A implementação respeita o mínimo de 30 min do Stripe (seção 5). */
  expiresAt: Date;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface CheckoutSessionState {
  id: string;
  orderId: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  paymentIntentId: string | null;
}

/** Resultado de expirar uma sessão: `complete` quer dizer que o pagamento venceu a corrida. */
export type ExpireCheckoutSessionResult = 'expired' | 'already-expired' | 'complete';

/**
 * Pagamentos (Stripe Checkout, seção 5). Chamado sempre fora de transação. Toda chamada que
 * cria algo usa chave de idempotência derivada do pedido: `order.id` na sessão e
 * `refund:<order.id>` no reembolso. Erro transitório do provedor é lançado; quem chama decide
 * se tenta de novo depois.
 */
export interface PaymentGateway {
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession>;
  expireCheckoutSession(sessionId: string): Promise<ExpireCheckoutSessionResult>;
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState>;
  refund(orderId: string, paymentIntentId: string): Promise<void>;
}

/**
 * O que a expiração e o cancelamento precisam do gateway: expirar a sessão antes de devolver
 * o estoque, para ela não poder mais ser paga. Até a etapa 4.1 a API usa uma implementação
 * nula, porque ainda não existem sessões.
 */
export type SessionExpirer = Pick<PaymentGateway, 'expireCheckoutSession'>;
