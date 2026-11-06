import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaUnitOfWork],
  // O webhook do Stripe (WebhooksModule) grava pela mesma unidade de trabalho.
  exports: [PrismaUnitOfWork],
})
export class OrdersModule {}
