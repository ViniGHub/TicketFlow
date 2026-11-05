import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaUnitOfWork],
})
export class OrdersModule {}
