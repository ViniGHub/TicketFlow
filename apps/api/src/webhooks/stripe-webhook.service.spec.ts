import { BadRequestException } from '@nestjs/common';
import { type TransactionalRepositories, type UnitOfWork } from '@ticketflow/domain';
import { StripeWebhookParser } from '@ticketflow/payments';
import { checkoutSessionEvent, signWebhook } from '@ticketflow/payments/testing';
import { describe, expect, it } from 'vitest';

import { StripeEventProcessingError, StripeWebhookService } from './stripe-webhook.service';

// O processamento com Postgres real (rollback, eventos simultâneos) fica em
// stripe-webhook.int-spec.ts. Aqui, só a tradução das falhas em status HTTP.

const SECRET = 'whsec_teste';
const parser = new StripeWebhookParser(SECRET);

/** Unidade de trabalho em que todo evento já foi registrado antes: nada é processado. */
const everyEventSeen: UnitOfWork = {
  run: (work) =>
    work({
      stripeEvents: { record: () => Promise.resolve(false) },
    } as unknown as TransactionalRepositories),
};

const failing: UnitOfWork = { run: () => Promise.reject(new Error('banco fora do ar')) };

function signed() {
  const event = checkoutSessionEvent({
    id: 'evt_1',
    sessionId: 'cs_test_1',
    orderId: '0193a4f2-0000-7000-8000-000000000001',
  });
  const { body, signature } = signWebhook(event, SECRET);
  return { body: Buffer.from(body), signature };
}

describe('StripeWebhookService', () => {
  it('evento com assinatura válida segue para o processamento', async () => {
    const { body, signature } = signed();

    await expect(
      new StripeWebhookService(everyEventSeen, parser).handle(body, signature),
    ).resolves.toEqual({ status: 'duplicate' });
  });

  it.each([
    ['sem assinatura', undefined],
    ['com assinatura inválida', 't=1,v1=invalida'],
  ])('evento %s vira 400, sem processar', async (_, signature) => {
    const { body } = signed();

    const result = new StripeWebhookService(failing, parser).handle(body, signature);

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_SIGNATURE' },
    });
  });

  it('sem corpo cru (Content-Type que não é JSON) também vira 400', async () => {
    const { signature } = signed();

    await expect(
      new StripeWebhookService(failing, parser).handle(undefined, signature),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falha no processamento vira erro interno (5xx), com a causa', async () => {
    const { body, signature } = signed();

    const result = new StripeWebhookService(failing, parser).handle(body, signature);

    await expect(result).rejects.toBeInstanceOf(StripeEventProcessingError);
    await expect(result).rejects.toMatchObject({
      message: expect.stringContaining('evt_1') as unknown,
      cause: new Error('banco fora do ar'),
    });
  });
});
