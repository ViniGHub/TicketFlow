import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';

import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [OrdersModule, PaymentsModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService],
})
export class WebhooksModule {}
