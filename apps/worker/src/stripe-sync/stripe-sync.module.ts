import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EXPIRE_ORDERS_JOB, RECONCILE_STRIPE_JOB } from '@ticketflow/contracts';
import {
  ExpirationService,
  type PaymentGateway,
  StripeEventProcessor,
  StripeReconciler,
  type UnitOfWork,
} from '@ticketflow/domain';
import { PrismaUnitOfWork } from '@ticketflow/persistence';

import { PAYMENT_GATEWAY } from '../payments/payments.module';

import { ExpireOrdersProcessor } from './expire-orders.processor';
import { JobSchedulers } from './job-schedulers';
import { ReconcileStripeProcessor } from './reconcile-stripe.processor';
import { StripeSyncService } from './stripe-sync.service';

/**
 * Expiração de pedidos e reconciliação com o Stripe (ROADMAP, etapa 5.3; ADR 0014): os
 * schedulers, os consumidores e as regras do domínio que eles usam.
 */
@Module({
  // Registrar as filas liga os consumidores (ADR 0013) e dá ao JobSchedulers as filas em que ele
  // agenda, com a conexão compartilhada, que espera o Redis voltar.
  imports: [BullModule.registerQueue({ name: EXPIRE_ORDERS_JOB }, { name: RECONCILE_STRIPE_JOB })],
  providers: [
    {
      provide: StripeEventProcessor,
      inject: [PrismaUnitOfWork],
      useFactory: (uow: UnitOfWork) => new StripeEventProcessor(uow),
    },
    {
      provide: ExpirationService,
      inject: [PrismaUnitOfWork, PAYMENT_GATEWAY],
      useFactory: (uow: UnitOfWork, gateway: PaymentGateway) => new ExpirationService(uow, gateway),
    },
    {
      provide: StripeReconciler,
      inject: [PrismaUnitOfWork, PAYMENT_GATEWAY, StripeEventProcessor],
      useFactory: (uow: UnitOfWork, gateway: PaymentGateway, processor: StripeEventProcessor) =>
        new StripeReconciler(uow, gateway, processor),
    },
    StripeSyncService,
    ExpireOrdersProcessor,
    ReconcileStripeProcessor,
    JobSchedulers,
  ],
})
export class StripeSyncModule {}
