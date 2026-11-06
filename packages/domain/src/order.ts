import type { EventStatus, SalesWindow } from './catalog.js';
import { DomainError } from './domain-error.js';
import { type Cents, multiplyCents, sumCents } from './money.js';
import type { OrderStatus } from './order-status.js';

// Pedido: tipos, erros da compra e cálculo do total (ROADMAP, etapa 3.1; ADR 0005). Status
// HTTP de cada código: apps/api/src/common/error-status.ts.

/**
 * Maior total de um pedido: R$ 999.999,99, o maior valor que o Stripe aceita em qualquer forma
 * de pagamento (8 dígitos; cartão aceita mais, Pix e boleto não). Cabe com folga em
 * `orders.total_cents` (INTEGER). O catálogo aceita até esse valor por ingresso e 100 ingressos
 * por pedido, então um único item pode passar do limite (ADR 0008).
 */
export const MAX_ORDER_TOTAL_CENTS: Cents = 99_999_999;

/**
 * Menor total de um pedido pago: R$ 0,50, o mínimo de cobrança do Stripe em BRL. Pedido de
 * total zero (ingresso gratuito) também passa pelo Checkout, que não cobra nada.
 */
export const MIN_PAID_ORDER_TOTAL_CENTS: Cents = 50;

export interface OrderItem {
  ticketTypeId: string;
  quantity: number;
  /** Preço copiado do lote no momento da compra. */
  unitPriceCents: Cents;
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  totalCents: Cents;
  currency: 'BRL';
  items: readonly OrderItem[];
  idempotencyKey: string | null;
  requestHash: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
}

/** Pedido a criar. Nasce `PENDING`; o repositório gera o id e as datas de criação. */
export interface NewOrder {
  userId: string;
  items: readonly OrderItem[];
  totalCents: Cents;
  expiresAt: Date;
  idempotencyKey: string | null;
  requestHash: string | null;
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';

  constructor(readonly ticketTypeId: string) {
    super('Não há ingressos suficientes neste lote.');
  }
}

export class SalesWindowClosedError extends DomainError {
  readonly code = 'SALES_WINDOW_CLOSED';

  constructor(
    readonly ticketTypeId: string,
    readonly reason: 'not-started' | 'ended',
  ) {
    super(
      reason === 'not-started'
        ? 'As vendas deste lote ainda não começaram.'
        : 'As vendas deste lote já terminaram.',
    );
  }
}

export class MaxPerOrderExceededError extends DomainError {
  readonly code = 'MAX_PER_ORDER_EXCEEDED';

  constructor(
    readonly ticketTypeId: string,
    readonly maxPerOrder: number,
    readonly requested: number,
  ) {
    super(
      `Este lote permite até ${maxPerOrder} ingresso(s) por pedido; foram pedidos ${requested}.`,
    );
  }
}

export class EventNotPublishedError extends DomainError {
  readonly code = 'EVENT_NOT_PUBLISHED';

  constructor(readonly eventId: string) {
    super('Este evento não está à venda.');
  }
}

/** Também para pedido de outro usuário: a resposta não revela que ele existe. */
export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';

  constructor() {
    super('Pedido não encontrado.');
  }
}

export class OrderNotCancellableError extends DomainError {
  readonly code = 'ORDER_NOT_CANCELLABLE';

  constructor(readonly status: OrderStatus) {
    super('Só é possível cancelar um pedido que ainda aguarda pagamento.');
  }
}

/** A sessão do Stripe já foi paga quando o cancelamento tentou expirá-la. */
export class OrderPaymentCompletedError extends DomainError {
  readonly code = 'ORDER_PAYMENT_COMPLETED';

  constructor() {
    super('O pagamento deste pedido já foi concluído; ele não pode mais ser cancelado.');
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor() {
    super('Esta Idempotency-Key já foi usada com outro corpo de requisição.');
  }
}

export class OrderTotalTooLargeError extends DomainError {
  readonly code = 'ORDER_TOTAL_TOO_LARGE';

  constructor(readonly totalCents: Cents) {
    super('O total do pedido passa do limite permitido. Divida a compra em mais pedidos.');
  }
}

export class OrderTotalTooSmallError extends DomainError {
  readonly code = 'ORDER_TOTAL_TOO_SMALL';

  constructor(readonly totalCents: Cents) {
    super('O total do pedido fica abaixo do valor mínimo de pagamento (R$ 0,50).');
  }
}

export interface PricedItem {
  unitPriceCents: Cents;
  quantity: number;
}

/**
 * Total do pedido em centavos. Lista vazia e quantidade menor que 1 são erro de programação
 * (a borda da API já recusa com 400), por isso `RangeError` e não erro de domínio.
 */
export function calculateOrderTotal(items: readonly PricedItem[]): Cents {
  if (items.length === 0) {
    throw new RangeError('Pedido sem itens.');
  }
  const total = sumCents(
    items.map(({ unitPriceCents, quantity }) => {
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new RangeError(`Quantidade inválida: ${quantity}`);
      }
      return multiplyCents(unitPriceCents, quantity);
    }),
  );
  if (total > MAX_ORDER_TOTAL_CENTS) {
    throw new OrderTotalTooLargeError(total);
  }
  if (total > 0 && total < MIN_PAID_ORDER_TOTAL_CENTS) {
    throw new OrderTotalTooSmallError(total);
  }
  return total;
}

export interface PurchaseCheck {
  event: { id: string; status: EventStatus };
  ticketType: SalesWindow & { id: string; maxPerOrder: number };
  quantity: number;
}

/**
 * Validações de um item antes de reservar (ARCHITECTURE.md, seção 5, passo 1): evento
 * publicado, vendas abertas (início inclusivo, fim exclusivo) e no máximo `max_per_order`.
 * O estoque fica de fora: quem confere é o decremento atômico da reserva (seção 6).
 */
export function assertPurchasable({ event, ticketType, quantity }: PurchaseCheck, now: Date): void {
  if (event.status !== 'PUBLISHED') {
    throw new EventNotPublishedError(event.id);
  }
  if (now.getTime() < ticketType.salesStart.getTime()) {
    throw new SalesWindowClosedError(ticketType.id, 'not-started');
  }
  if (now.getTime() >= ticketType.salesEnd.getTime()) {
    throw new SalesWindowClosedError(ticketType.id, 'ended');
  }
  if (quantity > ticketType.maxPerOrder) {
    throw new MaxPerOrderExceededError(ticketType.id, ticketType.maxPerOrder, quantity);
  }
}
