import { type EventSalesResponse, type OrderStatusValue } from '@ticketflow/contracts';

import { formatCents } from '../format';

// Painel de vendas do organizador (ROADMAP, etapa 6.3; ADR 0018). Só pedido pago conta como
// venda; reservado é o pedido à espera do pagamento (o estoque já está separado para ele).

/** A resposta de vendas; `ordersByStatus` vem do OpenAPI como mapa aberto. */
export type SalesData = Omit<EventSalesResponse, 'ordersByStatus'> & {
  ordersByStatus: Readonly<Partial<Record<string, number>>>;
};

export type SalesPart = 'sold' | 'reserved' | 'available';

export const SALES_PARTS: readonly { part: SalesPart; label: string }[] = [
  { part: 'sold', label: 'Vendidos' },
  { part: 'reserved', label: 'Reservados' },
  { part: 'available', label: 'Disponíveis' },
];

/** Os status na ordem do caminho do pedido, com o nome que o organizador entende. */
export const ORDER_STATUS_LABELS: readonly { status: OrderStatusValue; label: string }[] = [
  { status: 'PAID', label: 'Pagos' },
  { status: 'PENDING', label: 'Aguardando pagamento' },
  { status: 'PROCESSING', label: 'Pagamento em processamento' },
  { status: 'EXPIRED', label: 'Expirados' },
  { status: 'CANCELLED', label: 'Cancelados pelo comprador' },
  { status: 'REFUND_PENDING', label: 'Reembolso em andamento' },
  { status: 'REFUNDED', label: 'Reembolsados' },
];

export interface LotSales {
  id: string;
  name: string;
  revenue: string;
  /** "163 vendidos · 5 reservados · 32 disponíveis de 200" */
  figures: string;
  /** Partes da barra; as zeradas não entram. `rest` é o que sobra do total (ex.: reembolso). */
  parts: { part: SalesPart; value: number }[];
  rest: number;
  /** Nome acessível da barra, com todas as partes. */
  label: string;
}

export interface SalesView {
  revenue: string;
  sold: string;
  reserved: string;
  lots: LotSales[];
  orders: { status: OrderStatusValue; label: string; count: number }[];
}

const count = (value: number) => value.toLocaleString('pt-BR');

function toLotSales(lot: SalesData['ticketTypes'][number]): LotSales {
  const values: Record<SalesPart, number> = {
    sold: lot.sold,
    reserved: lot.reserved,
    available: lot.available,
  };
  const figures = `${count(lot.sold)} vendidos · ${count(lot.reserved)} reservados · ${count(lot.available)} disponíveis de ${count(lot.total)}`;
  return {
    id: lot.ticketTypeId,
    name: lot.name,
    revenue: formatCents(lot.revenueCents),
    figures,
    parts: SALES_PARTS.map(({ part }) => ({ part, value: values[part] })).filter(
      ({ value }) => value > 0,
    ),
    rest: Math.max(0, lot.total - lot.sold - lot.reserved - lot.available),
    label: `${lot.name}: ${figures}`,
  };
}

export function toSalesView(sales: SalesData): SalesView {
  const capacity = sales.ticketTypes.reduce((total, lot) => total + lot.total, 0);
  return {
    revenue: formatCents(sales.totals.revenueCents),
    sold: `${count(sales.totals.sold)} de ${count(capacity)}`,
    reserved: count(sales.totals.reserved),
    lots: sales.ticketTypes.map(toLotSales),
    orders: ORDER_STATUS_LABELS.map(({ status, label }) => ({
      status,
      label,
      count: sales.ordersByStatus[status] ?? 0,
    })),
  };
}
