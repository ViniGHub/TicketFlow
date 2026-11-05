import {
  type Order,
  OrderNotCancellableError,
  OrderNotFoundError,
  OrderPaymentCompletedError,
} from './order.js';
import { canTransition } from './order-status.js';
import { transitionOrder } from './order-transition.js';
import { type SessionExpirer, type UnitOfWork } from './ports.js';

// Cancelamento pelo comprador (ROADMAP, etapa 3.3; ARCHITECTURE.md, seção 4; ADR 0007).

export interface CancelOrderInput {
  orderId: string;
  userId: string;
}

/**
 * `PENDING → CANCELLED`, devolvendo o estoque. Mesma ordem da expiração:
 *
 * 1. Lê o pedido e confere o dono e o status.
 * 2. Fora de transação, expira a sessão no Stripe, se houver: depois disso ela não pode mais
 *    ser paga. Se o pagamento já foi concluído, o cancelamento é recusado.
 * 3. Numa transação, trava o pedido, **reconfere** o status (a expiração ou outro
 *    cancelamento podem ter chegado antes) e só então devolve o estoque.
 */
export async function cancelOrder(
  uow: UnitOfWork,
  sessionExpirer: SessionExpirer,
  { orderId, userId }: CancelOrderInput,
): Promise<Order> {
  const current = assertCancellableBy(
    await uow.run(({ orders }) => orders.findById(orderId)),
    userId,
  );

  if (current.stripeSessionId) {
    const result = await sessionExpirer.expireCheckoutSession(current.stripeSessionId);
    if (result === 'complete') {
      throw new OrderPaymentCompletedError();
    }
  }

  return uow.run(async (repositories) => {
    const order = assertCancellableBy(await repositories.orders.lockById(orderId), userId);
    return transitionOrder(repositories, order, 'CANCELLED');
  });
}

function assertCancellableBy(order: Order | null, userId: string): Order {
  if (!order || order.userId !== userId) {
    throw new OrderNotFoundError();
  }
  if (!canTransition(order.status, 'CANCELLED')) {
    throw new OrderNotCancellableError(order.status);
  }
  return order;
}
