import { Module } from '@nestjs/common';
import { type PaymentGateway } from '@ticketflow/domain';
import { createStripePaymentGateway } from '@ticketflow/payments';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

/**
 * Token de injeção do `PaymentGateway` (Stripe Checkout). Os testes de integração trocam o
 * provider pelo `FakePaymentGateway` (test/app.ts): nenhum teste fala com o Stripe.
 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Gateway do Stripe, do pacote compartilhado com o worker (ADR 0008). */
@Module({
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): PaymentGateway =>
        createStripePaymentGateway({ secretKey: env.STRIPE_SECRET_KEY, appUrl: env.APP_URL }),
    },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
