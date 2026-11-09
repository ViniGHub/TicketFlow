import { NestFactory } from '@nestjs/core';
import { StripePaymentGateway } from '@ticketflow/payments';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { describe, expect, it } from 'vitest';

import { PAYMENT_GATEWAY, PaymentsModule, type PaymentsModuleOptions } from './payments.module';

async function gatewayFor(options: PaymentsModuleOptions): Promise<unknown> {
  const app = await NestFactory.createApplicationContext(PaymentsModule.forRoot(options), {
    logger: false,
  });
  try {
    return app.get(PAYMENT_GATEWAY);
  } finally {
    await app.close();
  }
}

describe('PaymentsModule', () => {
  it('com a chave, monta o gateway do Stripe', async () => {
    const gateway = await gatewayFor({ secretKey: 'sk_test_123', appUrl: 'http://localhost:3001' });

    expect(gateway).toBeInstanceOf(StripePaymentGateway);
  });

  it('usa o gateway recebido no lugar do Stripe', async () => {
    const fake = new FakePaymentGateway();

    expect(await gatewayFor({ gateway: fake })).toBe(fake);
  });
});
