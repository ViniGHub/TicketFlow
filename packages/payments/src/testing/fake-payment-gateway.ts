import {
  type CheckoutSession,
  type CheckoutSessionRequest,
  type CheckoutSessionState,
  type ExpireCheckoutSessionResult,
  type PaymentGateway,
} from '@ticketflow/domain';

import { checkoutIdempotencyKey, refundIdempotencyKey } from '../stripe-payment-gateway.js';

// Gateway em memória para os testes da API e do worker: nenhum teste fala com o Stripe.
// Reproduz o que importa do Stripe para os fluxos do TicketFlow: a idempotência da criação, a
// URL só enquanto a sessão está aberta e os estados de uma sessão.

/** Mesma chave de idempotência com outros parâmetros: o Stripe recusa (ADR 0008). */
export class FakeIdempotencyError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Chave de idempotência ${idempotencyKey} reutilizada com outros parâmetros.`);
    this.name = 'FakeIdempotencyError';
  }
}

export interface CreateCall {
  /** A chave que o adaptador real mandaria ao Stripe. */
  idempotencyKey: string;
  request: CheckoutSessionRequest;
}

export interface RefundCall {
  orderId: string;
  paymentIntentId: string;
  idempotencyKey: string;
}

export class FakePaymentGateway implements PaymentGateway {
  readonly createCalls: CreateCall[] = [];
  readonly retrieveCalls: string[] = [];
  readonly expireCalls: string[] = [];
  readonly refundCalls: RefundCall[] = [];
  /** Roda a cada criação, antes de responder (ex.: outra transação muda o pedido no meio). */
  onCreate?: (request: CheckoutSessionRequest) => void | Promise<void>;

  private readonly sessions = new Map<string, CheckoutSessionState>();
  private readonly byIdempotencyKey = new Map<string, { params: string; sessionId: string }>();
  private readonly createFailures: Error[] = [];
  private created = 0;

  /** A próxima criação falha com `error`, sem criar a sessão. */
  failNextCreate(error: Error = new Error('Stripe indisponível (fake).')): void {
    this.createFailures.push(error);
  }

  /** O comprador pagou: a sessão fica `complete` e perde a URL. */
  complete(sessionId: string, paymentIntentId = `pi_test_${sessionId}`): void {
    const session = this.requireSession(sessionId);
    this.sessions.set(sessionId, {
      ...session,
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId,
      url: null,
    });
  }

  session(sessionId: string): CheckoutSessionState | undefined {
    const session = this.sessions.get(sessionId);
    return session && { ...session };
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Volta ao estado inicial, para reaproveitar a instância entre testes. */
  reset(): void {
    this.createCalls.length = 0;
    this.retrieveCalls.length = 0;
    this.expireCalls.length = 0;
    this.refundCalls.length = 0;
    this.onCreate = undefined;
    this.sessions.clear();
    this.byIdempotencyKey.clear();
    this.createFailures.length = 0;
    this.created = 0;
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const idempotencyKey = checkoutIdempotencyKey(request.orderId);
    this.createCalls.push({ idempotencyKey, request });
    await this.onCreate?.(request);
    const failure = this.createFailures.shift();
    if (failure) {
      throw failure;
    }

    const params = JSON.stringify(request);
    const previous = this.byIdempotencyKey.get(idempotencyKey);
    if (previous) {
      if (previous.params !== params) {
        throw new FakeIdempotencyError(idempotencyKey);
      }
      return this.toCreated(this.requireSession(previous.sessionId));
    }

    this.created += 1;
    const id = `cs_test_fake_${this.created}`;
    const session: CheckoutSessionState = {
      id,
      orderId: request.orderId,
      status: 'open',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      url: `https://checkout.stripe.test/c/pay/${id}`,
    };
    this.sessions.set(id, session);
    this.byIdempotencyKey.set(idempotencyKey, { params, sessionId: id });
    return this.toCreated(session);
  }

  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionState> {
    this.retrieveCalls.push(sessionId);
    const session = this.sessions.get(sessionId);
    return session ? Promise.resolve({ ...session }) : Promise.reject(missing(sessionId));
  }

  expireCheckoutSession(sessionId: string): Promise<ExpireCheckoutSessionResult> {
    this.expireCalls.push(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject(missing(sessionId));
    }
    if (session.status === 'complete') {
      return Promise.resolve('complete');
    }
    if (session.status === 'expired') {
      return Promise.resolve('already-expired');
    }
    this.sessions.set(sessionId, { ...session, status: 'expired', url: null });
    return Promise.resolve('expired');
  }

  refund(orderId: string, paymentIntentId: string): Promise<void> {
    this.refundCalls.push({
      orderId,
      paymentIntentId,
      idempotencyKey: refundIdempotencyKey(orderId),
    });
    return Promise.resolve();
  }

  private requireSession(sessionId: string): CheckoutSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw missing(sessionId);
    }
    return session;
  }

  private toCreated(session: CheckoutSessionState): CheckoutSession {
    // Como no Stripe: a resposta salva da criação continua com a URL.
    return { id: session.id, url: `https://checkout.stripe.test/c/pay/${session.id}` };
  }
}

function missing(sessionId: string): Error {
  return new Error(`Sessão inexistente no fake: ${sessionId}`);
}
