import { type DynamicModule, Module } from '@nestjs/common';
import { type PaymentGateway } from '@ticketflow/domain';
import { createStripePaymentGateway, type StripeGatewayConfig } from '@ticketflow/payments';

/** Token do `PaymentGateway` (Stripe Checkout), o mesmo adaptador da API (ADR 0008). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * `STRIPE_SECRET_KEY` e `APP_URL`, ou um gateway pronto: os testes passam o
 * `FakePaymentGateway`, e nenhum teste fala com o Stripe.
 */
export type PaymentsModuleOptions = StripeGatewayConfig | { gateway: PaymentGateway };

/** Gateway do Stripe para os jobs do worker (a partir da etapa 5.3). */
@Module({})
export class PaymentsModule {
  static forRoot(options: PaymentsModuleOptions): DynamicModule {
    return {
      module: PaymentsModule,
      global: true,
      providers: [
        {
          provide: PAYMENT_GATEWAY,
          useFactory: (): PaymentGateway =>
            'gateway' in options ? options.gateway : createStripePaymentGateway(options),
        },
      ],
      exports: [PAYMENT_GATEWAY],
    };
  }
}
