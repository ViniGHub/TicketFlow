import {
  type CheckoutSession,
  type CheckoutSessionRequest,
  type CheckoutSessionState,
  type ExpireCheckoutSessionResult,
  type PaymentGateway,
} from '@ticketflow/domain';
import Stripe from 'stripe';

import { checkoutExpiresAt } from './checkout-expires-at.js';

// Implementação do PaymentGateway com o SDK oficial do Stripe (ROADMAP, etapa 4.1;
// ARCHITECTURE.md, seção 5; ADR 0008). Usada pela API e, a partir da etapa 5.3, pelo worker.

/** Chave de idempotência da Checkout Session: o id do pedido (seção 7). */
export const checkoutIdempotencyKey = (orderId: string): string => orderId;

/** Chave de idempotência do reembolso (seção 7). */
export const refundIdempotencyKey = (orderId: string): string => `refund:${orderId}`;

/**
 * O que o gateway usa do cliente do Stripe. O `Stripe` do SDK satisfaz esta interface; os
 * testes passam um cliente de mentira.
 */
export interface StripeClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options: Stripe.RequestOptions,
      ): Promise<Stripe.Checkout.Session>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
      expire(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  refunds: {
    create(
      params: Stripe.RefundCreateParams,
      options: Stripe.RequestOptions,
    ): Promise<Stripe.Refund>;
  };
}

export interface StripePaymentGatewayOptions {
  /** Endereço do front (`APP_URL`), para onde o Stripe devolve o comprador. */
  appUrl: string;
}

export class StripePaymentGateway implements PaymentGateway {
  private readonly appUrl: string;

  constructor(
    private readonly stripe: StripeClient,
    { appUrl }: StripePaymentGatewayOptions,
  ) {
    this.appUrl = appUrl;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(this.sessionParams(request), {
      idempotencyKey: checkoutIdempotencyKey(request.orderId),
    });
    if (!session.url) {
      throw new Error(`O Stripe criou a sessão ${session.id} sem URL de pagamento.`);
    }
    return { id: session.id, url: session.url };
  }

  async expireCheckoutSession(sessionId: string): Promise<ExpireCheckoutSessionResult> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
      return 'expired';
    } catch (error) {
      // O Stripe só expira sessões `open` e não documenta um código de erro para as outras:
      // a própria sessão diz se ela já tinha expirado ou se o pagamento venceu a corrida.
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
        throw error;
      }
      const { status } = await this.stripe.checkout.sessions.retrieve(sessionId);
      if (status === 'expired') {
        return 'already-expired';
      }
      if (status === 'complete') {
        return 'complete';
      }
      throw error;
    }
  }

  async retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState> {
    return toSessionState(await this.stripe.checkout.sessions.retrieve(sessionId));
  }

  async refund(orderId: string, paymentIntentId: string): Promise<void> {
    await this.stripe.refunds.create(
      { payment_intent: paymentIntentId, metadata: { order_id: orderId } },
      { idempotencyKey: refundIdempotencyKey(orderId) },
    );
  }

  /**
   * Parâmetros da sessão, só a partir do pedido: a retentativa com a mesma chave precisa
   * mandar exatamente os mesmos, senão o Stripe recusa a chave.
   */
  private sessionParams(request: CheckoutSessionRequest): Stripe.Checkout.SessionCreateParams {
    const free = request.lineItems.every((item) => item.unitPriceCents === 0);
    return {
      mode: 'payment',
      line_items: request.lineItems.map(({ name, unitPriceCents, quantity }) => ({
        quantity,
        price_data: { currency: 'brl', unit_amount: unitPriceCents, product_data: { name } },
      })),
      // Só cartão no MVP: Pix e boleto concluem a sessão antes do pagamento (PROCESSING, etapa
      // 4.3). Pedido gratuito não coleta forma de pagamento nenhuma.
      ...(!free && { payment_method_types: ['card'] }),
      client_reference_id: request.orderId,
      metadata: { order_id: request.orderId },
      expires_at: checkoutExpiresAt(request),
      success_url: this.orderPageUrl(request.orderId, 'success'),
      cancel_url: this.orderPageUrl(request.orderId, 'cancel'),
      locale: 'pt-BR',
    };
  }

  /** Página do pedido no front, que consulta `GET /orders/:id` (seção 5, passo 5). */
  private orderPageUrl(orderId: string, checkout: 'success' | 'cancel'): string {
    const url = new URL(`/orders/${orderId}`, this.appUrl);
    url.searchParams.set('checkout', checkout);
    return url.toString();
  }
}

const SESSION_STATUSES = ['open', 'complete', 'expired'] as const;
const PAYMENT_STATUSES = ['paid', 'unpaid', 'no_payment_required'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return values.some((known) => known === value);
}

function toSessionState(session: Stripe.Checkout.Session): CheckoutSessionState {
  const orderId = session.metadata?.['order_id'] ?? session.client_reference_id;
  if (!orderId) {
    throw new Error(`A sessão ${session.id} não pertence a um pedido do TicketFlow.`);
  }
  // Os tipos do SDK aceitam valores futuros; um estado desconhecido não pode virar decisão.
  const { status, payment_status: paymentStatus } = session;
  if (!isOneOf(SESSION_STATUSES, status) || !isOneOf(PAYMENT_STATUSES, paymentStatus)) {
    throw new Error(
      `Estado desconhecido na sessão ${session.id}: ${String(status)}/${paymentStatus}.`,
    );
  }
  const paymentIntent = session.payment_intent;
  return {
    id: session.id,
    orderId,
    status,
    paymentStatus,
    paymentIntentId:
      typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null),
    url: session.url,
  };
}

/** Tempo de cada tentativa. O padrão do SDK (80 s) seguraria demais a requisição do comprador. */
export const STRIPE_TIMEOUT_MS = 10_000;

/**
 * Retentativas automáticas do SDK em erro de rede e 5xx. São seguras porque toda chamada que
 * cria algo leva a chave de idempotência do pedido.
 */
export const STRIPE_MAX_NETWORK_RETRIES = 2;

export interface StripeGatewayConfig extends StripePaymentGatewayOptions {
  /** `STRIPE_SECRET_KEY`. A versão da API é a fixada pelo SDK. */
  secretKey: string;
}

export function createStripePaymentGateway({
  secretKey,
  appUrl,
}: StripeGatewayConfig): StripePaymentGateway {
  const stripe = new Stripe(secretKey, {
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    appInfo: { name: 'TicketFlow' },
  });
  return new StripePaymentGateway(stripe, { appUrl });
}
