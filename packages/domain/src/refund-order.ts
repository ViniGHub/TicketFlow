import { type PaymentGateway, type UnitOfWork } from './ports.js';

// Job refund-order (ROADMAP, etapa 5.4; ARCHITECTURE.md, seção 8; ADR 0015).

/** O que o reembolso precisa do gateway. */
export type Refunder = Pick<PaymentGateway, 'refund'>;

export type RefundOrderSkipReason =
  /** Pedido inexistente: outro ambiente usando a mesma fila, por exemplo. */
  | 'order-not-found'
  /** O `charge.refunded` já chegou: não há o que fazer. */
  | 'already-refunded'
  /** O pedido não está esperando reembolso. */
  | 'not-refund-pending'
  /** Pedido sem PaymentIntent não teve cobrança (o reembolso dele não passa pelo job). */
  | 'no-payment-intent';

export type RefundOrderResult =
  { status: 'refund-requested' } | { status: 'skipped'; reason: RefundOrderSkipReason };

/**
 * Pede ao Stripe o reembolso de um pedido em `REFUND_PENDING`, fora de transação (CLAUDE.md,
 * regra 8), com a chave de idempotência `refund:<pedido>`. O pedido só vira `REFUNDED` quando
 * chega o `charge.refunded`, a fonte da verdade (ADR 0010).
 *
 * Repetir é seguro: um pedido já `REFUNDED` nem chama o Stripe; antes disso, a chave faz o
 * Stripe devolver o mesmo reembolso, e depois das 24 h dela o gateway trata a cobrança já
 * devolvida como sucesso. Erro do Stripe sobe, e o BullMQ tenta de novo com backoff.
 */
export async function refundOrder(
  uow: UnitOfWork,
  refunder: Refunder,
  orderId: string,
): Promise<RefundOrderResult> {
  const order = await uow.run(({ orders }) => orders.findById(orderId));
  if (!order) {
    return skipped('order-not-found');
  }
  if (order.status === 'REFUNDED') {
    return skipped('already-refunded');
  }
  if (order.status !== 'REFUND_PENDING') {
    return skipped('not-refund-pending');
  }
  if (order.stripePaymentIntentId === null) {
    return skipped('no-payment-intent');
  }
  await refunder.refund(order.id, order.stripePaymentIntentId);
  return { status: 'refund-requested' };
}

function skipped(reason: RefundOrderSkipReason): RefundOrderResult {
  return { status: 'skipped', reason };
}
