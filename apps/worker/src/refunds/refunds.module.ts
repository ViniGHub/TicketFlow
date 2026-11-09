import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { REFUND_ORDER_JOB } from '@ticketflow/contracts';

import { RefundOrderProcessor } from './refund-order.processor';

/** Reembolso dos pedidos no Stripe (ROADMAP, etapa 5.4; ADR 0015). */
@Module({
  // A fila registrada liga o consumidor (ADR 0013). O gateway vem do PaymentsModule, e a
  // unidade de trabalho, do DatabaseModule.
  imports: [BullModule.registerQueue({ name: REFUND_ORDER_JOB })],
  providers: [RefundOrderProcessor],
})
export class RefundsModule {}
