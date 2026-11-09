import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import {
  SEND_EVENT_CANCELLED_EMAIL_JOB,
  sendEventCancelledEmailPayloadSchema,
} from '@ticketflow/contracts';
import { type Job, UnrecoverableError } from 'bullmq';

import { jobFields, LoggedProcessor } from '../queues/logged-processor';

import {
  type EventCancelledEmailResult,
  EventCancelledEmailService,
} from './event-cancelled-email.service';

/** Consumidor da fila `send-event-cancelled-email`: o evento do pedido foi cancelado. */
@Processor(SEND_EVENT_CANCELLED_EMAIL_JOB)
export class SendEventCancelledEmailProcessor extends LoggedProcessor {
  constructor(
    @Inject(EventCancelledEmailService) private readonly emails: EventCancelledEmailService,
  ) {
    super();
  }

  async process(job: Job): Promise<EventCancelledEmailResult> {
    const payload = sendEventCancelledEmailPayloadSchema.safeParse(job.data);
    if (!payload.success) {
      throw new UnrecoverableError(`Payload inválido: ${payload.error.message}`);
    }

    const result = await this.emails.sendForOrder(payload.data.orderId);
    if (result.status === 'skipped') {
      this.logger.warn({
        message: 'Nenhum e-mail enviado',
        ...jobFields(job),
        reason: result.reason,
      });
    }
    return result;
  }
}
