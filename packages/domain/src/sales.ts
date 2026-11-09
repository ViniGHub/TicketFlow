import { type Cents } from './money.js';
import { ORDER_STATUSES, type OrderStatus } from './order-status.js';

// Vendas de um evento, para o organizador (ROADMAP, etapa 4.4; ADR 0011). O banco agrega; aqui
// fica a regra do que conta como vendido, reservado e receita.

/** Pedidos que contam como venda: o pagamento confirmado e não reembolsado. */
const SOLD: ReadonlySet<OrderStatus> = new Set(['PAID']);

/** Pedidos que ainda seguram o estoque à espera do pagamento. */
const RESERVED: ReadonlySet<OrderStatus> = new Set(['PENDING', 'PROCESSING']);

export interface SalesTicketType {
  id: string;
  name: string;
  priceCents: Cents;
  total: number;
  available: number;
}

/** Soma dos itens de um lote em pedidos de um status. */
export interface SalesByStatus {
  ticketTypeId: string;
  status: OrderStatus;
  quantity: number;
  /** Soma de `quantity × unit_price_cents`: o preço gravado no pedido, não o atual do lote. */
  amountCents: Cents;
}

/** Pedidos distintos de um status com ao menos um lote do evento. */
export interface OrdersByStatusCount {
  status: OrderStatus;
  orders: number;
}

export interface SalesCounts {
  sold: number;
  reserved: number;
  revenueCents: Cents;
}

export interface TicketTypeSales extends SalesTicketType, SalesCounts {}

export interface EventSales {
  ticketTypes: TicketTypeSales[];
  totals: SalesCounts;
  ordersByStatus: Record<OrderStatus, number>;
}

/**
 * Vendas por lote e pedidos por status. Lote sem venda aparece zerado, e todo status de
 * pedido aparece, mesmo com zero. Reembolsado ou em reembolso não é venda nem reserva.
 */
export function summarizeSales(
  ticketTypes: readonly SalesTicketType[],
  sums: readonly SalesByStatus[],
  orderCounts: readonly OrdersByStatusCount[],
): EventSales {
  const lots = ticketTypes.map((ticketType) => {
    const counts: SalesCounts = { sold: 0, reserved: 0, revenueCents: 0 };
    for (const sum of sums) {
      if (sum.ticketTypeId !== ticketType.id) {
        continue;
      }
      if (SOLD.has(sum.status)) {
        counts.sold += sum.quantity;
        counts.revenueCents += sum.amountCents;
      } else if (RESERVED.has(sum.status)) {
        counts.reserved += sum.quantity;
      }
    }
    return { ...ticketType, ...counts };
  });

  const totals: SalesCounts = { sold: 0, reserved: 0, revenueCents: 0 };
  for (const lot of lots) {
    totals.sold += lot.sold;
    totals.reserved += lot.reserved;
    totals.revenueCents += lot.revenueCents;
  }

  const ordersByStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<
    OrderStatus,
    number
  >;
  for (const { status, orders } of orderCounts) {
    ordersByStatus[status] += orders;
  }

  return { ticketTypes: lots, totals, ordersByStatus };
}
