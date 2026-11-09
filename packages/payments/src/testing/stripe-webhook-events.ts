import Stripe from 'stripe';

// Eventos de webhook assinados como o Stripe assina, para os testes da API e do worker
// (ARCHITECTURE.md, seção 13). Nada sai da máquina: a assinatura é um HMAC local.

export interface CheckoutSessionEventOptions {
  /** `evt_...`. Padrão: um id novo a cada chamada. */
  id?: string;
  type?: string;
  /** Data do evento. Padrão: agora. */
  created?: Date;
  sessionId: string;
  orderId: string | null;
  status?: 'open' | 'complete' | 'expired';
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  paymentIntentId?: string | null;
}

let sequence = 0;

/** Corpo de um evento `checkout.session.*`, com só os campos que o TicketFlow lê. */
export function checkoutSessionEvent({
  id = `evt_test_${Date.now()}_${++sequence}`,
  type = 'checkout.session.completed',
  created = new Date(),
  sessionId,
  orderId,
  status = type === 'checkout.session.expired' ? 'expired' : 'complete',
  paymentStatus = type === 'checkout.session.expired' ? 'unpaid' : 'paid',
  paymentIntentId = paymentStatus === 'paid' ? `pi_test_${sessionId}` : null,
}: CheckoutSessionEventOptions): Record<string, unknown> {
  return {
    id,
    object: 'event',
    type,
    created: Math.floor(created.getTime() / 1000),
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        status,
        payment_status: paymentStatus,
        payment_intent: paymentIntentId,
        client_reference_id: orderId,
        metadata: orderId === null ? {} : { order_id: orderId },
        url: null,
      },
    },
  };
}

export interface SignedWebhook {
  /** O corpo exatamente como foi assinado. */
  body: string;
  /** Valor do header `Stripe-Signature`. */
  signature: string;
}

/** Serializa o evento e assina com o segredo do webhook (`whsec_...`). */
export function signWebhook(
  event: Record<string, unknown>,
  secret: string,
  { timestamp }: { timestamp?: Date } = {},
): SignedWebhook {
  const body = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    ...(timestamp && { timestamp: Math.floor(timestamp.getTime() / 1000) }),
  });
  return { body, signature };
}

export interface ChargeRefundedEventOptions {
  /** `evt_...`. Padrão: um id novo a cada chamada. */
  id?: string;
  /** Data do evento. Padrão: agora. */
  created?: Date;
  chargeId?: string;
  paymentIntentId: string | null;
  /** Valor da charge, em centavos. */
  amountCents?: number;
  /** Quanto já foi devolvido. Padrão: o valor inteiro. */
  amountRefundedCents?: number;
}

/** Corpo de um evento `charge.refunded`, com só os campos que o TicketFlow lê. */
export function chargeRefundedEvent({
  id = `evt_test_${Date.now()}_${++sequence}`,
  created = new Date(),
  chargeId = `ch_test_${++sequence}`,
  paymentIntentId,
  amountCents = 10_000,
  amountRefundedCents = amountCents,
}: ChargeRefundedEventOptions): Record<string, unknown> {
  return {
    id,
    object: 'event',
    type: 'charge.refunded',
    created: Math.floor(created.getTime() / 1000),
    livemode: false,
    data: {
      object: {
        id: chargeId,
        object: 'charge',
        amount: amountCents,
        amount_refunded: amountRefundedCents,
        refunded: amountRefundedCents >= amountCents,
        payment_intent: paymentIntentId,
        currency: 'brl',
      },
    },
  };
}
