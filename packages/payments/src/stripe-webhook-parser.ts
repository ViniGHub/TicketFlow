import { type ChargeState, type PaymentEvent } from '@ticketflow/domain';
import Stripe from 'stripe';

import { ticketflowOrderIdOf, toSessionState } from './stripe-payment-gateway.js';

// Entrada do webhook do Stripe (ROADMAP, etapa 4.2; ARCHITECTURE.md, seção 5, passo 4).

/**
 * Assinatura ausente, adulterada, de outro segredo ou velha demais: o corpo não veio do
 * Stripe, ou não pode ser conferido. A API responde 400 e não processa nada.
 */
export class InvalidWebhookSignatureError extends Error {
  constructor(options?: ErrorOptions) {
    super('Assinatura do webhook do Stripe ausente ou inválida.', options);
    this.name = 'InvalidWebhookSignatureError';
  }
}

/**
 * Confere a assinatura (`Stripe-Signature`, HMAC do corpo cru com o `STRIPE_WEBHOOK_SECRET`) e
 * converte o evento no `PaymentEvent` do domínio. O corpo precisa ser exatamente o recebido:
 * reserializar o JSON muda os bytes e invalida a assinatura.
 */
export class StripeWebhookParser {
  constructor(private readonly webhookSecret: string) {}

  parse(rawBody: Uint8Array | string, signature: string | undefined): PaymentEvent {
    if (!signature) {
      throw new InvalidWebhookSignatureError();
    }
    let event: Stripe.Event;
    try {
      // Recusa também assinatura com mais de 5 minutos (tolerância padrão do SDK), contra replay.
      event = Stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw new InvalidWebhookSignatureError({ cause: error });
      }
      throw error;
    }
    return toPaymentEvent(event);
  }
}

function toPaymentEvent(event: Stripe.Event): PaymentEvent {
  return {
    id: event.id,
    type: event.type,
    createdAt: new Date(event.created * 1000),
    session: isCheckoutSessionEvent(event) ? sessionOf(event.data.object) : null,
    charge: isChargeEvent(event) ? chargeOf(event.data.object) : null,
  };
}

type CheckoutSessionEvent =
  | Stripe.CheckoutSessionCompletedEvent
  | Stripe.CheckoutSessionExpiredEvent
  | Stripe.CheckoutSessionAsyncPaymentSucceededEvent
  | Stripe.CheckoutSessionAsyncPaymentFailedEvent;

function isCheckoutSessionEvent(event: Stripe.Event): event is CheckoutSessionEvent {
  return event.data.object.object === 'checkout.session';
}

/** Sessão de outra integração na mesma conta não vira decisão sobre pedido nenhum. */
function sessionOf(session: Stripe.Checkout.Session): PaymentEvent['session'] {
  return ticketflowOrderIdOf(session) === null ? null : toSessionState(session);
}

type ChargeEvent =
  | Stripe.ChargeCapturedEvent
  | Stripe.ChargeExpiredEvent
  | Stripe.ChargeFailedEvent
  | Stripe.ChargePendingEvent
  | Stripe.ChargeRefundedEvent
  | Stripe.ChargeSucceededEvent
  | Stripe.ChargeUpdatedEvent;

function isChargeEvent(event: Stripe.Event): event is ChargeEvent {
  return event.data.object.object === 'charge';
}

/**
 * O pagamento por trás do evento, ligado ao pedido pelo PaymentIntent (ADR 0010). `refunded`
 * só fica `true` quando o valor inteiro foi devolvido.
 */
function chargeOf(charge: Stripe.Charge): ChargeState {
  const paymentIntent = charge.payment_intent;
  return {
    id: charge.id,
    paymentIntentId:
      typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null),
    fullyRefunded: charge.refunded === true,
  };
}
