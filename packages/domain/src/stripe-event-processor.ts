import {
  REFUND_ORDER_JOB,
  type RefundOrderPayload,
  SEND_TICKET_EMAIL_JOB,
  type SendTicketEmailPayload,
} from '@ticketflow/contracts';

import { InsufficientStockError, type Order } from './order.js';
import { type OrderStatus } from './order-status.js';
import { transitionOrder } from './order-transition.js';
import {
  type ChargeState,
  type CheckoutSessionState,
  type OrderStatusChanges,
  type PaymentEvent,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';
import { generateQrToken, ticketsFor } from './tickets.js';

// Processamento dos eventos do Stripe (ROADMAP, etapas 4.2 e 4.3; ARCHITECTURE.md, seções 4,
// 5 e 7; ADRs 0009 e 0010). Usado pelo webhook da API e, a partir da etapa 5.3, pelo worker.

export const CHECKOUT_SESSION_COMPLETED = 'checkout.session.completed';
export const CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED = 'checkout.session.async_payment_succeeded';
export const CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED = 'checkout.session.async_payment_failed';
export const CHECKOUT_SESSION_EXPIRED = 'checkout.session.expired';
export const CHARGE_REFUNDED = 'charge.refunded';

const SESSION_EVENTS: ReadonlySet<string> = new Set([
  CHECKOUT_SESSION_COMPLETED,
  CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED,
  CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED,
  CHECKOUT_SESSION_EXPIRED,
]);

/** Status em que o pagamento do pedido já foi registrado. */
const PAYMENT_RECORDED: ReadonlySet<OrderStatus> = new Set(['PAID', 'REFUND_PENDING', 'REFUNDED']);

/** Por que um evento foi registrado sem mudar nada. */
export type IgnoredStripeEventReason =
  /** Tipo que o TicketFlow não trata. */
  | 'unhandled-type'
  /** Sessão ou charge sem pedido do TicketFlow: outra integração na mesma conta do Stripe. */
  | 'not-ticketflow'
  /** Pedido inexistente: outro ambiente usando a mesma conta de teste, por exemplo. */
  | 'order-not-found'
  /** Sessão que não é a gravada no pedido, num evento sem dinheiro envolvido. */
  | 'session-mismatch'
  /** O pagamento do pedido já tinha sido registrado. */
  | 'already-paid'
  /** O pedido já saiu do estado que o evento mudaria: outro evento chegou antes. */
  | 'already-closed'
  /** O reembolso já tinha sido registrado. */
  | 'already-refunded'
  /** Reembolso de parte do valor: o TicketFlow só reembolsa o pedido inteiro. */
  | 'partial-refund'
  /** Reembolso de pedido que não foi pago (nenhum ingresso a anular). */
  | 'not-refundable';

/** Evento processado que pede atenção de quem opera: o webhook registra em log `warn`. */
export type StripeEventWarning =
  /** Pagamento de pedido já expirado, que voltou a ter o estoque reservado. */
  | 'late-payment-reserved'
  /** Pagamento de pedido já expirado, sem estoque: o pedido será reembolsado. */
  | 'late-payment-refund'
  /** Reembolso feito fora do TicketFlow (painel do Stripe) num pedido pago. */
  | 'refunded-outside-ticketflow';

export type StripeEventOutcome =
  | {
      status: 'processed';
      orderId: string;
      orderStatus: OrderStatus;
      warning?: StripeEventWarning;
    }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: IgnoredStripeEventReason; orderId?: string };

/**
 * O Stripe confirmou um pagamento que nenhuma transição aceita: pedido `CANCELLED`, sessão que
 * não é a gravada no pedido, ou pedido grátis sem estoque (não há o que reembolsar). Nenhum
 * desses casos tem caminho possível hoje. O evento não é registrado e o webhook responde 5xx:
 * o Stripe reenvia enquanto alguém investiga, em vez de o pagamento se perder. Sinal interno,
 * nunca chega ao comprador.
 */
export class UnexpectedPaymentError extends Error {
  constructor(
    readonly orderId: string,
    readonly orderStatus: OrderStatus,
    readonly sessionId: string,
  ) {
    super(
      `Pagamento confirmado na sessão ${sessionId} para o pedido ${orderId}, que está ` +
        `${orderStatus} e não pode recebê-lo.`,
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
 * trava o pedido e faz a transição, com o que vem junto dela (ingressos, outbox, estoque).
 * Qualquer erro desfaz tudo, inclusive o registro do evento, e o Stripe reenvia. Evento já
 * registrado não muda nada. O Stripe não garante a ordem dos eventos: cada um confere o status
 * do pedido em vez de supor qual veio antes.
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
    if (event.type === CHARGE_REFUNDED) {
      return refund(repositories, event.charge, event.createdAt);
    }
    if (!SESSION_EVENTS.has(event.type)) {
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

    switch (event.type) {
      case CHECKOUT_SESSION_COMPLETED:
        return session.paymentStatus === 'unpaid'
          ? awaitAsyncPayment(repositories, order, session)
          : this.confirmPayment(repositories, order, session, event.createdAt);
      case CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED:
        return this.confirmPayment(repositories, order, session, event.createdAt);
      case CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED:
        return failAsyncPayment(repositories, order, session);
      default:
        return expire(repositories, order, session);
    }
  }

  /**
   * Pagamento confirmado: sessão concluída paga (cartão) ou sem cobrança (pedido grátis), ou
   * pagamento assíncrono aprovado. `PENDING`/`PROCESSING → PAID`; pedido `EXPIRED` é
   * pagamento tardio.
   */
  private async confirmPayment(
    repositories: TransactionalRepositories,
    order: Order,
    session: CheckoutSessionState,
    paidAt: Date,
  ): Promise<StripeEventOutcome> {
    if (order.stripeSessionId !== session.id) {
      throw new UnexpectedPaymentError(order.id, order.status, session.id);
    }
    if (PAYMENT_RECORDED.has(order.status)) {
      return ignored('already-paid', order.id);
    }
    const changes = paymentChanges(session, paidAt);

    if (order.status === 'PENDING' || order.status === 'PROCESSING') {
      return processed(await this.markPaid(repositories, order, changes));
    }
    if (order.status !== 'EXPIRED') {
      throw new UnexpectedPaymentError(order.id, order.status, session.id);
    }

    // Pagamento tardio (seção 5): reserva de novo, ou reembolsa se o estoque acabou.
    try {
      const paid = await this.markPaid(repositories, order, changes);
      return processed(paid, 'late-payment-reserved');
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) {
        throw error;
      }
    }
    if (session.paymentIntentId === null) {
      throw new UnexpectedPaymentError(order.id, order.status, session.id);
    }
    // A re-reserva é tudo ou nada (transitionOrder): nenhum lote ficou descontado.
    const refunding = await transitionOrder(repositories, order, 'REFUND_PENDING', changes);
    const payload: RefundOrderPayload = { orderId: order.id };
    await repositories.outbox.add({ type: REFUND_ORDER_JOB, payload });
    return processed(refunding, 'late-payment-refund');
  }

  /** `→ PAID`, um ingresso por unidade e o e-mail na outbox. */
  private async markPaid(
    repositories: TransactionalRepositories,
    order: Order,
    changes: OrderStatusChanges,
  ): Promise<Order> {
    const paid = await transitionOrder(repositories, order, 'PAID', changes);
    await repositories.tickets.createMany(ticketsFor(order, this.newQrToken));
    const payload: SendTicketEmailPayload = { orderId: order.id };
    await repositories.outbox.add({ type: SEND_TICKET_EMAIL_JOB, payload });
    return paid;
  }
}

/**
 * Sessão concluída sem pagamento confirmado (Pix, boleto): `PENDING → PROCESSING`. O estoque
 * continua reservado até o Stripe aprovar ou recusar (seção 4).
 */
async function awaitAsyncPayment(
  repositories: TransactionalRepositories,
  order: Order,
  session: CheckoutSessionState,
): Promise<StripeEventOutcome> {
  if (order.stripeSessionId !== session.id) {
    return ignored('session-mismatch', order.id);
  }
  if (order.status !== 'PENDING') {
    // O resultado do pagamento assíncrono chegou antes deste evento.
    return ignored(
      PAYMENT_RECORDED.has(order.status) ? 'already-paid' : 'already-closed',
      order.id,
    );
  }
  const changes: OrderStatusChanges = {};
  if (session.paymentIntentId !== null) {
    changes.stripePaymentIntentId = session.paymentIntentId;
  }
  return processed(await transitionOrder(repositories, order, 'PROCESSING', changes));
}

/** Pagamento assíncrono recusado: `PROCESSING → EXPIRED`, devolvendo o estoque. */
async function failAsyncPayment(
  repositories: TransactionalRepositories,
  order: Order,
  session: CheckoutSessionState,
): Promise<StripeEventOutcome> {
  if (order.stripeSessionId !== session.id) {
    return ignored('session-mismatch', order.id);
  }
  // PENDING: a recusa chegou antes do `completed`, que depois é ignorado.
  if (order.status !== 'PROCESSING' && order.status !== 'PENDING') {
    return ignored('already-closed', order.id);
  }
  return processed(await transitionOrder(repositories, order, 'EXPIRED'));
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

/**
 * `charge.refunded` com o valor inteiro devolvido: `REFUND_PENDING → REFUNDED` e os ingressos
 * anulados. Reembolso feito pelo painel do Stripe num pedido `PAID` passa pelas duas
 * transições na mesma transação: o dinheiro já voltou, e os ingressos não podem continuar
 * valendo. Reembolso não devolve estoque (seção 4).
 */
async function refund(
  repositories: TransactionalRepositories,
  charge: ChargeState | null,
  refundedAt: Date,
): Promise<StripeEventOutcome> {
  if (!charge?.paymentIntentId) {
    return ignored('not-ticketflow');
  }
  const order = await repositories.orders.lockByPaymentIntent(charge.paymentIntentId);
  if (!order) {
    return ignored('order-not-found');
  }
  if (!charge.fullyRefunded) {
    return ignored('partial-refund', order.id);
  }
  if (order.status === 'REFUNDED') {
    return ignored('already-refunded', order.id);
  }
  if (order.status !== 'PAID' && order.status !== 'REFUND_PENDING') {
    return ignored('not-refundable', order.id);
  }

  const refunding =
    order.status === 'PAID' ? await transitionOrder(repositories, order, 'REFUND_PENDING') : order;
  const refunded = await transitionOrder(repositories, refunding, 'REFUNDED');
  await repositories.tickets.voidByOrder(order.id, refundedAt);
  return processed(refunded, order.status === 'PAID' ? 'refunded-outside-ticketflow' : undefined);
}

/** `paid_at` e o PaymentIntent, gravados junto com o pagamento (pedido grátis não tem). */
function paymentChanges(session: CheckoutSessionState, paidAt: Date): OrderStatusChanges {
  const changes: OrderStatusChanges = { paidAt };
  if (session.paymentIntentId !== null) {
    changes.stripePaymentIntentId = session.paymentIntentId;
  }
  return changes;
}

function processed(order: Order, warning?: StripeEventWarning): StripeEventOutcome {
  const outcome = { status: 'processed', orderId: order.id, orderStatus: order.status } as const;
  return warning === undefined ? outcome : { ...outcome, warning };
}

function ignored(reason: IgnoredStripeEventReason, orderId?: string): StripeEventOutcome {
  return orderId === undefined
    ? { status: 'ignored', reason }
    : { status: 'ignored', reason, orderId };
}
