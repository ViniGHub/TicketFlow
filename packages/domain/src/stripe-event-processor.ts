import { SEND_TICKET_EMAIL_JOB, type SendTicketEmailPayload } from '@ticketflow/contracts';

import { type Order } from './order.js';
import { type OrderStatus } from './order-status.js';
import { transitionOrder } from './order-transition.js';
import {
  type CheckoutSessionState,
  type OrderStatusChanges,
  type PaymentEvent,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';
import { generateQrToken, ticketsFor } from './tickets.js';

// Processamento dos eventos do Stripe (ROADMAP, etapa 4.2; ARCHITECTURE.md, seções 5 e 7;
// ADR 0009). Usado pelo webhook da API e, a partir da etapa 5.3, pelo worker.

export const CHECKOUT_SESSION_COMPLETED = 'checkout.session.completed';
export const CHECKOUT_SESSION_EXPIRED = 'checkout.session.expired';

/** Por que um evento foi registrado sem mudar nada. */
export type IgnoredStripeEventReason =
  /** Tipo que o TicketFlow não trata. */
  | 'unhandled-type'
  /** Sessão sem `order_id` de um pedido: outra integração na mesma conta do Stripe. */
  | 'not-ticketflow'
  /** Pedido inexistente: outro ambiente usando a mesma conta de teste, por exemplo. */
  | 'order-not-found'
  /** Sessão expirada que não é a gravada no pedido: a do pedido continua valendo. */
  | 'session-mismatch'
  /** O pedido já estava pago. */
  | 'already-paid'
  /** Sessão expirada de pedido que já saiu de `PENDING` (cancelado ou expirado antes). */
  | 'already-closed'
  /** Sessão concluída sem pagamento confirmado (Pix, etapa 4.3). */
  | 'payment-pending';

export type StripeEventOutcome =
  | { status: 'processed'; orderId: string; orderStatus: OrderStatus }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: IgnoredStripeEventReason; orderId?: string };

/**
 * O Stripe confirmou um pagamento que o pedido não espera mais: pagamento tardio de pedido
 * `EXPIRED`, ou de uma sessão que não é a gravada no pedido. O tratamento (re-reservar ou
 * reembolsar) é da etapa 4.3. Até lá o evento não é registrado e o webhook responde 5xx, para
 * o Stripe reenviar em vez de o pagamento se perder. Sinal interno: nunca chega ao comprador.
 */
export class UnexpectedPaymentError extends Error {
  constructor(
    readonly orderId: string,
    readonly orderStatus: OrderStatus,
    readonly sessionId: string,
  ) {
    super(
      `Pagamento confirmado na sessão ${sessionId} para o pedido ${orderId}, que está ` +
        `${orderStatus} e não espera mais por ele.`,
    );
    this.name = 'UnexpectedPaymentError';
  }
}

export interface StripeEventProcessorOptions {
  /** Gerador do `qr_token`; os testes passam um determinista. */
  newQrToken?: () => string;
}

/**
 * Aplica um evento do Stripe numa única transação: registra o evento em `stripe_events`,
 * trava o pedido, faz a transição e, no pagamento, emite os ingressos e grava o e-mail na
 * outbox. Qualquer erro desfaz tudo, inclusive o registro do evento, e o Stripe reenvia.
 * Evento já registrado não muda nada.
 */
export class StripeEventProcessor {
  private readonly newQrToken: () => string;

  constructor(
    private readonly uow: UnitOfWork,
    { newQrToken = generateQrToken }: StripeEventProcessorOptions = {},
  ) {
    this.newQrToken = newQrToken;
  }

  process(event: PaymentEvent): Promise<StripeEventOutcome> {
    return this.uow.run(async (repositories) => {
      if (!(await repositories.stripeEvents.record(event.id, event.type))) {
        return { status: 'duplicate' };
      }
      return this.apply(repositories, event);
    });
  }

  private async apply(
    repositories: TransactionalRepositories,
    event: PaymentEvent,
  ): Promise<StripeEventOutcome> {
    if (event.type !== CHECKOUT_SESSION_COMPLETED && event.type !== CHECKOUT_SESSION_EXPIRED) {
      return ignored('unhandled-type');
    }
    const { session } = event;
    if (!session) {
      return ignored('not-ticketflow');
    }
    const order = await repositories.orders.lockById(session.orderId);
    if (!order) {
      return ignored('order-not-found', session.orderId);
    }
    return event.type === CHECKOUT_SESSION_COMPLETED
      ? this.complete(repositories, order, session, event.createdAt)
      : expire(repositories, order, session);
  }

  /** `checkout.session.completed`: `PENDING → PAID`, ingressos e e-mail na outbox. */
  private async complete(
    repositories: TransactionalRepositories,
    order: Order,
    session: CheckoutSessionState,
    paidAt: Date,
  ): Promise<StripeEventOutcome> {
    if (session.paymentStatus === 'unpaid') {
      return ignored('payment-pending', order.id);
    }
    // Pago (cartão) ou sem cobrança (pedido grátis, sem PaymentIntent).
    if (order.stripeSessionId !== session.id) {
      throw new UnexpectedPaymentError(order.id, order.status, session.id);
    }
    if (order.status === 'PAID') {
      return ignored('already-paid', order.id);
    }
    if (order.status !== 'PENDING') {
      throw new UnexpectedPaymentError(order.id, order.status, session.id);
    }

    const changes: OrderStatusChanges = { paidAt };
    if (session.paymentIntentId !== null) {
      changes.stripePaymentIntentId = session.paymentIntentId;
    }
    const paid = await transitionOrder(repositories, order, 'PAID', changes);
    await repositories.tickets.createMany(ticketsFor(order, this.newQrToken));
    const payload: SendTicketEmailPayload = { orderId: order.id };
    await repositories.outbox.add({ type: SEND_TICKET_EMAIL_JOB, payload });
    return processed(paid);
  }
}

/** `checkout.session.expired`: `PENDING → EXPIRED`, devolvendo o estoque. */
async function expire(
  repositories: TransactionalRepositories,
  order: Order,
  session: CheckoutSessionState,
): Promise<StripeEventOutcome> {
  if (order.stripeSessionId !== session.id) {
    return ignored('session-mismatch', order.id);
  }
  // O cancelamento e a expiração expiram a sessão antes de mudar o pedido: o aviso do Stripe
  // chega depois, ou no meio, e quem travar o pedido primeiro devolve o estoque.
  if (order.status !== 'PENDING') {
    return ignored('already-closed', order.id);
  }
  return processed(await transitionOrder(repositories, order, 'EXPIRED'));
}

function processed(order: Order): StripeEventOutcome {
  return { status: 'processed', orderId: order.id, orderStatus: order.status };
}

function ignored(reason: IgnoredStripeEventReason, orderId?: string): StripeEventOutcome {
  return orderId === undefined
    ? { status: 'ignored', reason }
    : { status: 'ignored', reason, orderId };
}
