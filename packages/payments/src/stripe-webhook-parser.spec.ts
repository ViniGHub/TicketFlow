import { describe, expect, it } from 'vitest';

import { InvalidWebhookSignatureError, StripeWebhookParser } from './stripe-webhook-parser.js';
import {
  chargeRefundedEvent,
  checkoutSessionEvent,
  signWebhook,
} from './testing/stripe-webhook-events.js';

const SECRET = 'whsec_segredo_de_teste';
const orderId = '0193a4f2-0000-7000-8000-000000000001';
const created = new Date('2026-11-20T12:05:00Z');
const parser = new StripeWebhookParser(SECRET);

function completed(overrides: Partial<Parameters<typeof checkoutSessionEvent>[0]> = {}) {
  return checkoutSessionEvent({ id: 'evt_1', sessionId: 'cs_test_1', orderId, ...overrides });
}

describe('assinatura do webhook', () => {
  it('aceita o corpo assinado com o segredo do webhook, como texto ou bytes', () => {
    const { body, signature } = signWebhook(completed(), SECRET);

    expect(parser.parse(body, signature).id).toBe('evt_1');
    expect(parser.parse(Buffer.from(body), signature).id).toBe('evt_1');
  });

  it('recusa corpo alterado depois de assinado', () => {
    const { body, signature } = signWebhook(completed(), SECRET);
    const tampered = body.replace('"paid"', '"unpaid"');

    expect(() => parser.parse(tampered, signature)).toThrow(InvalidWebhookSignatureError);
  });

  it('recusa o mesmo JSON reserializado com outra formatação', () => {
    const event = completed();
    const { signature } = signWebhook(event, SECRET);

    expect(() => parser.parse(JSON.stringify(event, null, 2), signature)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it('recusa assinatura feita com outro segredo', () => {
    const { body, signature } = signWebhook(completed(), 'whsec_outro_segredo');

    expect(() => parser.parse(body, signature)).toThrow(InvalidWebhookSignatureError);
  });

  it.each([undefined, '', 'nao-e-uma-assinatura'])('recusa o header %j', (signature) => {
    const { body } = signWebhook(completed(), SECRET);

    expect(() => parser.parse(body, signature)).toThrow(InvalidWebhookSignatureError);
  });

  it('recusa assinatura com mais de 5 minutos (replay)', () => {
    const { body, signature } = signWebhook(completed(), SECRET, {
      timestamp: new Date(Date.now() - 10 * 60_000),
    });

    expect(() => parser.parse(body, signature)).toThrow(InvalidWebhookSignatureError);
  });
});

describe('conversão do evento', () => {
  it('traz o id, o tipo, a data e a sessão do pedido', () => {
    const { body, signature } = signWebhook(completed({ created }), SECRET);

    expect(parser.parse(body, signature)).toEqual({
      id: 'evt_1',
      type: 'checkout.session.completed',
      createdAt: created,
      session: {
        id: 'cs_test_1',
        orderId,
        status: 'complete',
        paymentStatus: 'paid',
        paymentIntentId: 'pi_test_cs_test_1',
        url: null,
      },
      charge: null,
    });
  });

  it('sessão expirada vem sem PaymentIntent', () => {
    const event = completed({ type: 'checkout.session.expired' });
    const { body, signature } = signWebhook(event, SECRET);

    expect(parser.parse(body, signature).session).toMatchObject({
      status: 'expired',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
    });
  });

  it('evento que não é de Checkout Session nem de charge vem sem os dois', () => {
    const event = {
      id: 'evt_2',
      object: 'event',
      type: 'customer.created',
      created: Math.floor(created.getTime() / 1000),
      data: { object: { id: 'cus_1', object: 'customer' } },
    };
    const { body, signature } = signWebhook(event, SECRET);

    expect(parser.parse(body, signature)).toEqual({
      id: 'evt_2',
      type: 'customer.created',
      createdAt: created,
      session: null,
      charge: null,
    });
  });

  it('charge.refunded traz a charge, com o PaymentIntent e o reembolso total', () => {
    const event = chargeRefundedEvent({
      id: 'evt_3',
      created,
      chargeId: 'ch_1',
      paymentIntentId: 'pi_1',
    });
    const { body, signature } = signWebhook(event, SECRET);

    expect(parser.parse(body, signature)).toEqual({
      id: 'evt_3',
      type: 'charge.refunded',
      createdAt: created,
      session: null,
      charge: { id: 'ch_1', paymentIntentId: 'pi_1', fullyRefunded: true },
    });
  });

  it('reembolso parcial vem com fullyRefunded false', () => {
    const event = chargeRefundedEvent({
      paymentIntentId: 'pi_1',
      amountCents: 10_000,
      amountRefundedCents: 4_000,
    });
    const { body, signature } = signWebhook(event, SECRET);

    expect(parser.parse(body, signature).charge).toMatchObject({ fullyRefunded: false });
  });

  it('charge sem PaymentIntent, ou com ele expandido, vem com o id certo', () => {
    const withoutIntent = signWebhook(chargeRefundedEvent({ paymentIntentId: null }), SECRET);
    const expanded = chargeRefundedEvent({ paymentIntentId: null });
    const data = expanded['data'] as { object: Record<string, unknown> };
    data.object['payment_intent'] = { id: 'pi_expandido', object: 'payment_intent' };
    const withExpanded = signWebhook(expanded, SECRET);

    expect(parser.parse(withoutIntent.body, withoutIntent.signature).charge).toMatchObject({
      paymentIntentId: null,
    });
    expect(parser.parse(withExpanded.body, withExpanded.signature).charge).toMatchObject({
      paymentIntentId: 'pi_expandido',
    });
  });

  it.each([
    ['sem order_id', null],
    ['com order_id que não é um id de pedido', '12345'],
  ])('sessão de outra integração (%s) vem sem sessão', (_, foreignOrderId) => {
    const { body, signature } = signWebhook(completed({ orderId: foreignOrderId }), SECRET);

    expect(parser.parse(body, signature).session).toBeNull();
  });

  it('estado de sessão desconhecido não vira decisão', () => {
    const event = completed();
    const data = event['data'] as { object: Record<string, unknown> };
    data.object['payment_status'] = 'algo_novo';
    const { body, signature } = signWebhook(event, SECRET);

    expect(() => parser.parse(body, signature)).toThrow(/Estado desconhecido/);
  });
});
