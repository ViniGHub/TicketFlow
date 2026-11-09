import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SEND_EVENT_CANCELLED_EMAIL_JOB } from '@ticketflow/contracts';

import { EventCancelledEmailService } from './event-cancelled-email.service';
import { SendEventCancelledEmailProcessor } from './send-event-cancelled-email.processor';

/** E-mail aos compradores de um evento cancelado (ROADMAP, etapa 5.4; ADR 0015). */
@Module({
  // A fila registrada liga o consumidor (ADR 0013); o transporte vem do EmailModule.
  imports: [BullModule.registerQueue({ name: SEND_EVENT_CANCELLED_EMAIL_JOB })],
  providers: [EventCancelledEmailService, SendEventCancelledEmailProcessor],
})
export class EventCancelledEmailModule {}
