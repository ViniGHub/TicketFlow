import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';
import { NullSessionExpirer, SESSION_EXPIRER } from './session-expirer';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    PrismaUnitOfWork,
    // Até a etapa 4.1 não há sessões no Stripe para expirar.
    { provide: SESSION_EXPIRER, useClass: NullSessionExpirer },
  ],
})
export class OrdersModule {}
