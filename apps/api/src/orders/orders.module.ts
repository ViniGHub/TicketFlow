import { Module } from '@nestjs/common';
import { PrismaClient } from '@ticketflow/db';
import { PrismaUnitOfWork } from '@ticketflow/persistence';

import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    // Do pacote compartilhado com o worker (ADR 0014): classe comum, registrada aqui.
    {
      provide: PrismaUnitOfWork,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaUnitOfWork(prisma),
    },
  ],
  // O webhook do Stripe (WebhooksModule) grava pela mesma unidade de trabalho.
  exports: [PrismaUnitOfWork],
})
export class OrdersModule {}
