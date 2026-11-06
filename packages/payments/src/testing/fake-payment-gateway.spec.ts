import { type CheckoutSessionRequest } from '@ticketflow/domain';
import { describe, expect, it } from 'vitest';

import { FakeIdempotencyError, FakePaymentGateway } from './fake-payment-gateway.js';

const request: CheckoutSessionRequest = {
  orderId: 'pedido-1',
  lineItems: [{ name: 'Show de Teste – Pista', unitPriceCents: 8_000, quantity: 2 }],
  expiresAt: new Date('2026-11-20T12:30:00Z'),
  orderCreatedAt: new Date('2026-11-20T12:00:00Z'),
};

describe('FakePaymentGateway', () => {
  it('como o Stripe, a mesma chave com os mesmos parâmetros devolve a mesma sessão', async () => {
    const gateway = new FakePaymentGateway();

    const first = await gateway.createCheckoutSession(request);
    const retry = await gateway.createCheckoutSession({ ...request });

    expect(retry).toEqual(first);
    expect(gateway.sessionCount).toBe(1);
    expect(gateway.createCalls.map((call) => call.idempotencyKey)).toEqual([
      'pedido-1',
      'pedido-1',
    ]);
  });

  it('a mesma chave com outros parâmetros é recusada', async () => {
    const gateway = new FakePaymentGateway();
    await gateway.createCheckoutSession(request);

    await expect(
      gateway.createCheckoutSession({ ...request, expiresAt: new Date('2026-11-20T12:31:00Z') }),
    ).rejects.toThrow(FakeIdempotencyError);
  });

  it('falha configurada não cria sessão e vale para uma chamada só', async () => {
    const gateway = new FakePaymentGateway();
    gateway.failNextCreate();

    await expect(gateway.createCheckoutSession(request)).rejects.toThrow(/indisponível/);
    expect(gateway.sessionCount).toBe(0);
    await expect(gateway.createCheckoutSession(request)).resolves.toMatchObject({
      id: 'cs_test_fake_1',
    });
  });

  it('a URL só aparece enquanto a sessão está aberta', async () => {
    const gateway = new FakePaymentGateway();
    const { id, url } = await gateway.createCheckoutSession(request);

    await expect(gateway.retrieveCheckoutSession(id)).resolves.toMatchObject({
      status: 'open',
      url,
    });
    await expect(gateway.expireCheckoutSession(id)).resolves.toBe('expired');
    await expect(gateway.retrieveCheckoutSession(id)).resolves.toMatchObject({
      status: 'expired',
      url: null,
    });
    await expect(gateway.expireCheckoutSession(id)).resolves.toBe('already-expired');
  });

  it('sessão paga não expira', async () => {
    const gateway = new FakePaymentGateway();
    const { id } = await gateway.createCheckoutSession(request);
    gateway.complete(id);

    await expect(gateway.expireCheckoutSession(id)).resolves.toBe('complete');
    expect(gateway.session(id)).toMatchObject({ status: 'complete', paymentStatus: 'paid' });
  });

  it('sessão inexistente é erro', async () => {
    const gateway = new FakePaymentGateway();

    await expect(gateway.retrieveCheckoutSession('cs_x')).rejects.toThrow(/inexistente/);
    await expect(gateway.expireCheckoutSession('cs_x')).rejects.toThrow(/inexistente/);
  });

  it('registra o reembolso com a chave refund:<pedido>', async () => {
    const gateway = new FakePaymentGateway();

    await gateway.refund('pedido-1', 'pi_1');

    expect(gateway.refundCalls).toEqual([
      { orderId: 'pedido-1', paymentIntentId: 'pi_1', idempotencyKey: 'refund:pedido-1' },
    ]);
  });

  it('reset volta ao estado inicial', async () => {
    const gateway = new FakePaymentGateway();
    await gateway.createCheckoutSession(request);
    gateway.failNextCreate();

    gateway.reset();

    expect(gateway.sessionCount).toBe(0);
    expect(gateway.createCalls).toEqual([]);
    await expect(gateway.createCheckoutSession(request)).resolves.toMatchObject({
      id: 'cs_test_fake_1',
    });
  });
});
