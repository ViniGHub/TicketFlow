import {
  type CheckoutSessionState,
  type PaymentEvent,
  type PaymentGateway,
  type UnitOfWork,
} from './ports.js';
import {
  CHECKOUT_SESSION_COMPLETED,
  CHECKOUT_SESSION_EXPIRED,
  type StripeEventOutcome,
  type StripeEventProcessor,
} from './stripe-event-processor.js';

// Reconciliação com o Stripe (ROADMAP, etapa 5.3; ARCHITECTURE.md, seção 5, passos 6 e 7;
// ADR 0014): consulta a sessão e aplica o estado dela pelo mesmo processador do webhook.

/** Pedido esperando pagamento há mais que isso tem a sessão consultada no Stripe. */
export const RECONCILE_AFTER_MS = 10 * 60 * 1000;
export const RECONCILE_BATCH_SIZE = 100;

/** O que a reconciliação precisa do gateway. */
export type SessionReader = Pick<PaymentGateway, 'retrieveCheckoutSession'>;

/** Sessão ainda aberta: o comprador pode pagar; não há o que aplicar. */
export type ReconcileResult = StripeEventOutcome | { status: 'still-open' };

export interface ReconciliationSummary {
  reconciled: { orderId: string; result: ReconcileResult }[];
  /** Erro ao consultar o Stripe ou ao gravar: o pedido fica para a próxima execução. */
  failed: { orderId: string; error: unknown }[];
}

/**
 * O estado atual da sessão como se fosse o webhook. Sessão aberta não vira evento. O id é
 * estável por estado (`reconcile:<sessão>:<status>:<payment_status>`): reconciliar o mesmo
 * estado de novo é um evento repetido, e um estado novo (o Pix aprovado depois) é outro
 * evento. `paid_at` fica com a hora da reconciliação: a sessão não informa a do pagamento.
 */
export function paymentEventFromSession(
  session: CheckoutSessionState,
  now: Date,
): PaymentEvent | null {
  if (session.status === 'open') {
    return null;
  }
  return {
    id: `reconcile:${session.id}:${session.status}:${session.paymentStatus}`,
    type: session.status === 'expired' ? CHECKOUT_SESSION_EXPIRED : CHECKOUT_SESSION_COMPLETED,
    createdAt: now,
    session,
    charge: null,
  };
}

/**
 * Aplica no pedido o que o Stripe sabe da sessão, quando o webhook não chegou ou ainda não
 * chegou. A consulta ao Stripe acontece fora de transação (CLAUDE.md, regra 8); o processador
 * abre a sua e trava o pedido.
 */
export class StripeReconciler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionReader,
    private readonly processor: StripeEventProcessor,
  ) {}

  async reconcileSession(sessionId: string, now: Date): Promise<ReconcileResult> {
    const session = await this.sessions.retrieveCheckoutSession(sessionId);
    const event = paymentEventFromSession(session, now);
    return event ? this.processor.process(event) : { status: 'still-open' };
  }

  /**
   * Um pedido pelo id. Usado pela expiração quando o Stripe responde que a sessão já foi paga:
   * o pagamento venceu a corrida, e o pedido vira `PAID` em vez de expirar.
   */
  async reconcileOrder(orderId: string, now: Date): Promise<ReconcileResult | null> {
    const order = await this.uow.run(({ orders }) => orders.findById(orderId));
    if (!order?.stripeSessionId) {
      return null;
    }
    return this.reconcileSession(order.stripeSessionId, now);
  }

  /**
   * Pedidos `PENDING` ou `PROCESSING` com sessão, criados há mais de 10 min (job
   * `reconcile-stripe`). Recupera webhooks perdidos, de pagamento ou de expiração.
   */
  async reconcileAwaitingPayment(
    now: Date,
    batchSize = RECONCILE_BATCH_SIZE,
  ): Promise<ReconciliationSummary> {
    const createdBefore = new Date(now.getTime() - RECONCILE_AFTER_MS);
    const orders = await this.uow.run(({ orders: repository }) =>
      repository.findAwaitingPayment(createdBefore, batchSize),
    );
    const summary: ReconciliationSummary = { reconciled: [], failed: [] };
    for (const order of orders) {
      if (!order.stripeSessionId) {
        continue;
      }
      try {
        const result = await this.reconcileSession(order.stripeSessionId, now);
        summary.reconciled.push({ orderId: order.id, result });
      } catch (error) {
        summary.failed.push({ orderId: order.id, error });
      }
    }
    return summary;
  }
}
