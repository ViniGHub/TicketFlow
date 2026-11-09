import {
  REFUND_ORDER_JOB,
  type RefundOrderPayload,
  SEND_EVENT_CANCELLED_EMAIL_JOB,
  type SendEventCancelledEmailPayload,
} from '@ticketflow/contracts';

import { EventNotFoundError } from './catalog.js';
import { DomainError } from './domain-error.js';
import { type Order } from './order.js';
import { transitionOrder } from './order-transition.js';
import {
  type OrderStatusChanges,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';

// Cancelamento de evento pelo organizador (ROADMAP, etapa 5.4; ARCHITECTURE.md, seção 5;
// ADR 0015).

export class EventNotCancellableError extends DomainError {
  readonly code = 'EVENT_NOT_CANCELLABLE';

  constructor() {
    super('Só um evento publicado pode ser cancelado; um rascunho pode ser excluído.');
  }
}

export interface CancelEventInput {
  eventId: string;
  organizerId: string;
  now: Date;
}

export interface CancelEventResult {
  /** `already-cancelled`: o evento já estava cancelado, e nada mudou. */
  outcome: 'cancelled' | 'already-cancelled';
  /** Pagos com cobrança: `REFUND_PENDING`, com `refund-order` na outbox. */
  refunding: string[];
  /** Pagos sem cobrança (pedido grátis): `REFUNDED` na hora. */
  refunded: string[];
  /** `PENDING`: a reserva acabou agora; o job `expire-orders` expira a sessão e o pedido. */
  reservationsEnded: string[];
  /** `PROCESSING`: o Stripe ainda vai aprovar ou recusar; se aprovar, vira reembolso. */
  awaitingPayment: string[];
}

/**
 * Cancela um evento publicado numa única transação. Nenhuma chamada ao Stripe acontece aqui
 * (CLAUDE.md, regra 8):
 *
 * 1. Trava o evento, como as escritas do catálogo: as compras em andamento terminam antes, e
 *    as novas esperam e encontram o evento cancelado.
 * 2. Trava os pedidos ativos do evento, em ordem de id.
 * 3. Pedido pago: reembolso pedido (ingressos anulados, `refund-order` na outbox) e e-mail de
 *    aviso. Pedido pendente: a reserva acaba agora, e o job de expiração expira a sessão no
 *    Stripe antes de devolver o estoque. Pedido em `PROCESSING` espera o Stripe.
 * 4. Marca o evento como `CANCELLED`.
 *
 * Um pagamento que chegue depois, numa sessão que ainda não expirou, vira reembolso no
 * processador de eventos do Stripe.
 */
export function cancelEvent(
  uow: UnitOfWork,
  { eventId, organizerId, now }: CancelEventInput,
): Promise<CancelEventResult> {
  return uow.run(async (repositories) => {
    const event = await repositories.catalog.lockOwnedEvent(eventId, organizerId);
    if (!event) {
      throw new EventNotFoundError();
    }
    const result: CancelEventResult = {
      outcome: 'cancelled',
      refunding: [],
      refunded: [],
      reservationsEnded: [],
      awaitingPayment: [],
    };
    if (event.status === 'CANCELLED') {
      return { ...result, outcome: 'already-cancelled' };
    }
    if (event.status !== 'PUBLISHED') {
      throw new EventNotCancellableError();
    }

    for (const order of await repositories.orders.lockActiveByEvent(eventId)) {
      if (order.status === 'PAID') {
        const after = await refundForCancelledEvent(repositories, order, now);
        (after.status === 'REFUNDED' ? result.refunded : result.refunding).push(order.id);
      } else if (order.status === 'PENDING') {
        await repositories.orders.endReservation(order.id, now);
        result.reservationsEnded.push(order.id);
      } else {
        result.awaitingPayment.push(order.id);
      }
    }
    await repositories.catalog.markEventCancelled(eventId, now);
    return result;
  });
}

/**
 * Pedido pago, ou com o pagamento recém-confirmado, de um evento cancelado: reembolso e
 * e-mail de aviso ao comprador. O pedido inteiro é reembolsado, mesmo com ingressos de outro
 * evento (ADR 0015).
 */
export async function refundForCancelledEvent(
  repositories: TransactionalRepositories,
  order: Order,
  at: Date,
  changes?: OrderStatusChanges,
): Promise<Order> {
  const after = await requestRefund(repositories, order, at, changes);
  const payload: SendEventCancelledEmailPayload = { orderId: order.id };
  await repositories.outbox.add({ type: SEND_EVENT_CANCELLED_EMAIL_JOB, payload });
  return after;
}

/**
 * `→ REFUND_PENDING` (de `PAID` ou de `EXPIRED`), com os ingressos anulados na hora: o
 * check-in já recusa. Com PaymentIntent, grava `refund-order` na outbox, e o pedido vira
 * `REFUNDED` quando chegar o `charge.refunded` (ADR 0010). Sem PaymentIntent (pedido grátis),
 * não há dinheiro a devolver: vira `REFUNDED` na mesma transação.
 */
async function requestRefund(
  repositories: TransactionalRepositories,
  order: Order,
  at: Date,
  changes?: OrderStatusChanges,
): Promise<Order> {
  const refunding = await transitionOrder(repositories, order, 'REFUND_PENDING', changes);
  await repositories.tickets.voidByOrder(order.id, at);
  if (refunding.stripePaymentIntentId === null) {
    return transitionOrder(repositories, refunding, 'REFUNDED');
  }
  const payload: RefundOrderPayload = { orderId: order.id };
  await repositories.outbox.add({ type: REFUND_ORDER_JOB, payload });
  return refunding;
}
