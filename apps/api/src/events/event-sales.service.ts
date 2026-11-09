import { Inject, Injectable } from '@nestjs/common';
import { type EventSalesResponse } from '@ticketflow/contracts';
import { PrismaClient } from '@ticketflow/db';
import { type OrderStatus, summarizeSales } from '@ticketflow/domain';

import { assertOwnsEvent } from './owned-event';

interface SumRow {
  ticket_type_id: string;
  status: OrderStatus;
  quantity: bigint;
  amount_cents: bigint;
}

interface CountRow {
  status: OrderStatus;
  orders: bigint;
}

/**
 * Vendas do evento para o organizador dono (ROADMAP, etapa 4.4; ADR 0011). O banco agrega os
 * itens por lote e status do pedido; o domínio decide o que conta como vendido e reservado.
 */
@Injectable()
export class EventSalesService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async forEvent(organizerId: string, eventId: string): Promise<EventSalesResponse> {
    await assertOwnsEvent(this.prisma, organizerId, eventId);

    const [ticketTypes, sums, counts] = await Promise.all([
      this.prisma.ticketType.findMany({
        where: { eventId },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, priceCents: true, total: true, available: true },
      }),
      // quantity × preço em bigint: 100 ingressos de R$ 999.999,99 passam do int4.
      this.prisma.$queryRaw<SumRow[]>`
        SELECT oi.ticket_type_id, o.status,
               SUM(oi.quantity)::bigint AS quantity,
               SUM(oi.quantity::bigint * oi.unit_price_cents)::bigint AS amount_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN ticket_types tt ON tt.id = oi.ticket_type_id
        WHERE tt.event_id = ${eventId}::uuid
        GROUP BY oi.ticket_type_id, o.status`,
      // Um pedido com vários lotes do evento conta uma vez.
      this.prisma.$queryRaw<CountRow[]>`
        SELECT o.status, COUNT(DISTINCT o.id)::bigint AS orders
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN ticket_types tt ON tt.id = oi.ticket_type_id
        WHERE tt.event_id = ${eventId}::uuid
        GROUP BY o.status`,
    ]);

    const sales = summarizeSales(
      ticketTypes,
      sums.map((row) => ({
        ticketTypeId: row.ticket_type_id,
        status: row.status,
        quantity: Number(row.quantity),
        amountCents: Number(row.amount_cents),
      })),
      counts.map((row) => ({ status: row.status, orders: Number(row.orders) })),
    );

    return {
      eventId,
      currency: 'BRL',
      ticketTypes: sales.ticketTypes.map(({ id, ...rest }) => ({ ticketTypeId: id, ...rest })),
      totals: sales.totals,
      ordersByStatus: sales.ordersByStatus,
    };
  }
}
