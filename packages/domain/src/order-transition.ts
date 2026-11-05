import { compareIds } from './ids.js';
import { InsufficientStockError, type Order } from './order.js';
import { type OrderStatus, stockEffectOf } from './order-status.js';
import { type OrderStatusChanges, type TransactionalRepositories } from './ports.js';

/**
 * Aplica uma transição dentro da transação recebida (ARCHITECTURE.md, seção 4): primeiro o
 * efeito no estoque, devolvendo ou reservando de novo lote a lote em ordem de id, depois o
 * novo status. Transição fora da tabela lança antes de mexer em qualquer coisa. Quem chama
 * já travou o pedido e conferiu o status atual.
 */
export async function transitionOrder(
  { orders, inventory }: Pick<TransactionalRepositories, 'orders' | 'inventory'>,
  order: Order,
  to: OrderStatus,
  changes: OrderStatusChanges = {},
): Promise<Order> {
  const effect = stockEffectOf(order.status, to);
  const items = [...order.items].sort((a, b) => compareIds(a.ticketTypeId, b.ticketTypeId));

  if (effect === 'release') {
    for (const { ticketTypeId, quantity } of items) {
      await inventory.release(ticketTypeId, quantity);
    }
  } else if (effect === 'reserve') {
    for (const { ticketTypeId, quantity } of items) {
      if (!(await inventory.tryReserve(ticketTypeId, quantity))) {
        throw new InsufficientStockError(ticketTypeId);
      }
    }
  }

  await orders.updateStatus(order.id, to, changes);
  return { ...order, ...changes, status: to };
}
