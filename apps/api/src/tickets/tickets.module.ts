import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { CheckInController, MyTicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuthModule],
  controllers: [MyTicketsController, CheckInController],
  providers: [TicketsService],
})
export class TicketsModule {}
