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
  tickets: TicketRepository;
  stripeEvents: StripeEventRepository;
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

/** Nome do lote e título do evento, para descrever os itens na página de pagamento. */
export interface TicketTypeLabel {
  id: string;
  name: string;
  eventTitle: string;
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

  /** Nomes dos lotes e dos eventos, sem trava. Lote inexistente fica fora do resultado. */
  findLabels(ticketTypeIds: readonly string[]): Promise<TicketTypeLabel[]>;
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

/** Ingresso a emitir. O `event_id` desnormalizado (seção 3) a implementação lê do lote. */
export interface NewTicket {
  orderId: string;
  ticketTypeId: string;
  /** 32 bytes aleatórios em base64url (seção 10). */
  qrToken: string;
}

export interface TicketRepository {
  /** Emite os ingressos, na mesma transação da mudança do pedido para `PAID`. */
  createMany(tickets: readonly NewTicket[]): Promise<void>;
}

/** Eventos do Stripe já processados (seção 7). */
export interface StripeEventRepository {
  /**
   * Registra o evento como processado, sem erro se ele já existe (`ON CONFLICT DO NOTHING`).
   * Devolve `false` quando outra transação já o registrou: é uma entrega repetida. Se essa
   * outra transação ainda está aberta, espera por ela.
   */
  record(eventId: string, type: string): Promise<boolean>;
}

export interface CheckoutLineItem {
  name: string;
  unitPriceCents: Cents;
  quantity: number;
}

/**
 * Sessão de pagamento de um pedido. Tudo aqui vem do pedido gravado, nada do relógio: uma
 * retentativa com a mesma chave de idempotência precisa mandar ao Stripe exatamente os mesmos
 * parâmetros, senão ele recusa a chave (ADR 0008).
 */
export interface CheckoutSessionRequest {
  orderId: string;
  lineItems: readonly CheckoutLineItem[];
  /** Fim da reserva (`orders.expires_at`). */
  expiresAt: Date;
  /**
   * Criação do pedido: a referência para os limites de validade da sessão no Stripe (de 30 min
   * a 24 h). A implementação ajusta `expiresAt` a esses limites (seção 5).
   */
  orderCreatedAt: Date;
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
  /** Página de pagamento. O Stripe só a informa enquanto a sessão está `open`. */
  url: string | null;
}

/**
 * Evento do Stripe com a assinatura já conferida (seção 5, passo 4). `session` vem preenchida
 * nos eventos de Checkout Session de um pedido do TicketFlow; é `null` nos outros tipos e nas
 * sessões sem `order_id`.
 */
export interface PaymentEvent {
  id: string;
  type: string;
  /** Quando o Stripe gerou o evento. */
  createdAt: Date;
  session: CheckoutSessionState | null;
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
 * o estoque, para ela não poder mais ser paga.
 */
export type SessionExpirer = Pick<PaymentGateway, 'expireCheckoutSession'>;

/** O que a abertura do pagamento (`startCheckout`) precisa do gateway. */
export type CheckoutGateway = Pick<
  PaymentGateway,
  'createCheckoutSession' | 'retrieveCheckoutSession' | 'expireCheckoutSession'
>;
