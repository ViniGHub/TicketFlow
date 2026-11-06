import { type CheckoutSessionRequest } from '@ticketflow/domain';
import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createStripePaymentGateway,
  type StripeClient,
  StripePaymentGateway,
} from './stripe-payment-gateway.js';

const orderId = '0193a4f2-0000-7000-8000-000000000001';
const appUrl = 'http://localhost:3001';

const request: CheckoutSessionRequest = {
  orderId,
  lineItems: [
    { name: 'Show de Teste – Pista', unitPriceCents: 8_000, quantity: 2 },
    { name: 'Show de Teste – Meia', unitPriceCents: 4_000, quantity: 1 },
  ],
  expiresAt: new Date('2026-11-20T12:30:00Z'),
  orderCreatedAt: new Date('2026-11-20T12:00:00Z'),
};

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    status: 'open',
    payment_status: 'unpaid',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    metadata: { order_id: orderId },
    client_reference_id: orderId,
    payment_intent: null,
    ...overrides,
  } as Stripe.Checkout.Session;
}

type Sessions = StripeClient['checkout']['sessions'];

function setup(gatewayAppUrl = appUrl) {
  const sessions = {
    create: vi.fn<Sessions['create']>(() => Promise.resolve(session())),
    retrieve: vi.fn<Sessions['retrieve']>(() => Promise.resolve(session())),
    expire: vi.fn<Sessions['expire']>(() =>
      Promise.resolve(session({ status: 'expired', url: null })),
    ),
  };
  const refunds = {
    create: vi.fn<StripeClient['refunds']['create']>(() =>
      Promise.resolve({ id: 're_test_1' } as Stripe.Refund),
    ),
  };
  const gateway = new StripePaymentGateway(
    { checkout: { sessions }, refunds },
    { appUrl: gatewayAppUrl },
  );
  return { gateway, sessions, refunds };
}

const invalidRequest = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    message: 'This Checkout Session is not in an expireable state.',
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('criação da Checkout Session', () => {
  it('manda os itens, o pedido e as URLs, com a chave de idempotência order.id', async () => {
    const { gateway, sessions } = setup();

    const created = await gateway.createCheckoutSession(request);

    expect(created).toEqual({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    expect(sessions.create).toHaveBeenCalledExactlyOnceWith(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 2,
            price_data: {
              currency: 'brl',
              unit_amount: 8_000,
              product_data: { name: 'Show de Teste – Pista' },
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: 4_000,
              product_data: { name: 'Show de Teste – Meia' },
            },
          },
        ],
        payment_method_types: ['card'],
        client_reference_id: orderId,
        metadata: { order_id: orderId },
        // Reserva de 30 min: a sessão vale 35, o mínimo do Stripe mais a folga.
        expires_at: Date.parse('2026-11-20T12:35:00Z') / 1000,
        success_url: `${appUrl}/orders/${orderId}?checkout=success`,
        cancel_url: `${appUrl}/orders/${orderId}?checkout=cancel`,
        locale: 'pt-BR',
      },
      { idempotencyKey: orderId },
    );
  });

  it('a retentativa, minutos depois, manda os mesmos parâmetros e a mesma chave', async () => {
    const { gateway, sessions } = setup();
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-11-20T12:00:01Z'));
    await gateway.createCheckoutSession(request);
    vi.setSystemTime(new Date('2026-11-20T12:04:00Z'));
    await gateway.createCheckoutSession({ ...request, lineItems: [...request.lineItems] });

    const [first, retry] = sessions.create.mock.calls;
    expect(retry).toEqual(first);
    expect(retry?.[1]).toEqual({ idempotencyKey: orderId });
  });

  it('pedido gratuito não pede forma de pagamento', async () => {
    const { gateway, sessions } = setup();

    await gateway.createCheckoutSession({
      ...request,
      lineItems: [{ name: 'Show de Teste – Cortesia', unitPriceCents: 0, quantity: 2 }],
    });

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params).not.toHaveProperty('payment_method_types');
    expect(params?.line_items?.[0]?.price_data?.unit_amount).toBe(0);
  });

  it('APP_URL com barra no fim não duplica a barra', async () => {
    const { gateway, sessions } = setup(`${appUrl}/`);

    await gateway.createCheckoutSession(request);

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params?.success_url).toBe(`${appUrl}/orders/${orderId}?checkout=success`);
  });

  it('sessão criada sem URL é erro', async () => {
    const { gateway, sessions } = setup();
    sessions.create.mockResolvedValueOnce(session({ url: null }));

    await expect(gateway.createCheckoutSession(request)).rejects.toThrow(/sem URL/);
  });

  it('erro do Stripe chega a quem chamou', async () => {
    const { gateway, sessions } = setup();
    const error = new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'falhou' });
    sessions.create.mockRejectedValueOnce(error);

    await expect(gateway.createCheckoutSession(request)).rejects.toBe(error);
  });
});

describe('expiração da Checkout Session', () => {
  it('sessão aberta: expira', async () => {
    const { gateway, sessions } = setup();

    await expect(gateway.expireCheckoutSession('cs_test_1')).resolves.toBe('expired');
    expect(sessions.expire).toHaveBeenCalledExactlyOnceWith('cs_test_1');
  });

  it.each([
    ['expired', 'already-expired'],
    ['complete', 'complete'],
  ] as const)('sessão que já estava %s: %s', async (status, result) => {
    const { gateway, sessions } = setup();
    sessions.expire.mockRejectedValueOnce(invalidRequest());
    sessions.retrieve.mockResolvedValueOnce(session({ status, url: null }));

    await expect(gateway.expireCheckoutSession('cs_test_1')).resolves.toBe(result);
  });

  it('recusa com a sessão ainda aberta: repassa o erro', async () => {
    const { gateway, sessions } = setup();
    const error = invalidRequest();
    sessions.expire.mockRejectedValueOnce(error);

    await expect(gateway.expireCheckoutSession('cs_test_1')).rejects.toBe(error);
  });

  it('erro de rede: repassa sem consultar a sessão', async () => {
    const { gateway, sessions } = setup();
    const error = new Stripe.errors.StripeConnectionError({
      type: 'api_error',
      message: 'sem conexão',
    });
    sessions.expire.mockRejectedValueOnce(error);

    await expect(gateway.expireCheckoutSession('cs_test_1')).rejects.toBe(error);
    expect(sessions.retrieve).not.toHaveBeenCalled();
  });
});

describe('consulta da Checkout Session', () => {
  it('traduz a sessão para o estado do domínio', async () => {
    const { gateway, sessions } = setup();
    sessions.retrieve.mockResolvedValueOnce(
      session({
        status: 'complete',
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        url: null,
      }),
    );

    await expect(gateway.retrieveCheckoutSession('cs_test_1')).resolves.toEqual({
      id: 'cs_test_1',
      orderId,
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_test_1',
      url: null,
    });
  });

  it('aceita o PaymentIntent expandido e o pedido só no client_reference_id', async () => {
    const { gateway, sessions } = setup();
    sessions.retrieve.mockResolvedValueOnce(
      session({ metadata: {}, payment_intent: { id: 'pi_test_2' } as Stripe.PaymentIntent }),
    );

    await expect(gateway.retrieveCheckoutSession('cs_test_1')).resolves.toMatchObject({
      orderId,
      paymentIntentId: 'pi_test_2',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
  });

  it('sessão que não é de um pedido é erro', async () => {
    const { gateway, sessions } = setup();
    sessions.retrieve.mockResolvedValueOnce(session({ metadata: {}, client_reference_id: null }));

    await expect(gateway.retrieveCheckoutSession('cs_test_1')).rejects.toThrow(/não pertence/);
  });

  it('estado que o domínio não conhece é erro, não decisão', async () => {
    const { gateway, sessions } = setup();
    sessions.retrieve.mockResolvedValueOnce(session({ status: null }));

    await expect(gateway.retrieveCheckoutSession('cs_test_1')).rejects.toThrow(
      /Estado desconhecido/,
    );
  });
});

describe('reembolso', () => {
  it('reembolsa o PaymentIntent com a chave refund:<pedido>', async () => {
    const { gateway, refunds } = setup();

    await gateway.refund(orderId, 'pi_test_1');

    expect(refunds.create).toHaveBeenCalledExactlyOnceWith(
      { payment_intent: 'pi_test_1', metadata: { order_id: orderId } },
      { idempotencyKey: `refund:${orderId}` },
    );
  });
});

describe('createStripePaymentGateway', () => {
  it('monta o gateway sem chamar o Stripe', () => {
    expect(createStripePaymentGateway({ secretKey: 'sk_test_x', appUrl })).toBeInstanceOf(
      StripePaymentGateway,
    );
  });
});
