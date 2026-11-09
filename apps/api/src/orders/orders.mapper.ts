import { type OrderResponse } from '@ticketflow/contracts';
import { type Order } from '@ticketflow/domain';

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
