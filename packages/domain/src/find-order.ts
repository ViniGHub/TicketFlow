import { type Order, OrderNotFoundError } from './order.js';
import { type UnitOfWork } from './ports.js';

// Consulta do pedido pelo comprador (ROADMAP, etapa 4.1; ARCHITECTURE.md, seções 5 e 10).

export interface FindBuyerOrderInput {
  orderId: string;
  userId: string;
}

/**
 * O pedido, se for de `userId`. Pedido de outro comprador responde como inexistente, para a
 * resposta não revelar que ele existe.
 */
export async function findBuyerOrder(
  uow: UnitOfWork,
  { orderId, userId }: FindBuyerOrderInput,
): Promise<Order> {
  const order = await uow.run(({ orders }) => orders.findById(orderId));
  if (!order || order.userId !== userId) {
    throw new OrderNotFoundError();
  }
  return order;
}
