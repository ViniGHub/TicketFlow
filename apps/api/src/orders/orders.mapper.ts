import { type OrderResponse } from '@ticketflow/contracts';
import { type $Enums, type Prisma } from '@ticketflow/db';
import { type Order, type OrderStatus } from '@ticketflow/domain';

/** Itens em ordem de lote, a mesma da reserva. */
export const withItems = {
  items: { orderBy: { ticketTypeId: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof withItems }>;

/**
 * Enum do banco para o estado do domínio. Se o banco ganhar um valor que o domínio não
 * conhece (ou o contrário), o typecheck quebra aqui ou no `updateStatus` (ADR 0005).
 */
const ORDER_STATUS_FROM_DB: Readonly<Record<$Enums.OrderStatus, OrderStatus>> = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
};

export function toDomainOrder(row: OrderRow): Order {
  // A API só grava BRL (ARCHITECTURE.md, seção 3); outra moeda aqui é dado corrompido.
  if (row.currency !== 'BRL') {
    throw new Error(`Moeda inesperada no pedido ${row.id}: ${row.currency}`);
  }
  return {
    id: row.id,
    userId: row.userId,
    status: ORDER_STATUS_FROM_DB[row.status],
    totalCents: row.totalCents,
    currency: 'BRL',
    items: row.items.map(({ ticketTypeId, quantity, unitPriceCents }) => ({
      ticketTypeId,
      quantity,
      unitPriceCents,
    })),
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    stripeSessionId: row.stripeSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    status: order.status,
    totalCents: order.totalCents,
    currency: order.currency,
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    items: order.items.map(({ ticketTypeId, quantity, unitPriceCents }) => ({
      ticketTypeId,
      quantity,
      unitPriceCents,
    })),
  };
}
