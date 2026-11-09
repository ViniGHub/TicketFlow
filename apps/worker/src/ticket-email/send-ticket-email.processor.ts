import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { SEND_TICKET_EMAIL_JOB, sendTicketEmailPayloadSchema } from '@ticketflow/contracts';
import { type Job, UnrecoverableError } from 'bullmq';

import { jobFields, LoggedProcessor } from '../queues/logged-processor';

import { type TicketEmailResult, TicketEmailService } from './ticket-email.service';

/** Consumidor da fila `send-ticket-email`: o pedido virou `PAID` (ARCHITECTURE.md, seção 8). */
@Processor(SEND_TICKET_EMAIL_JOB)
export class SendTicketEmailProcessor extends LoggedProcessor {
  constructor(@Inject(TicketEmailService) private readonly emails: TicketEmailService) {
    super();
  }

  async process(job: Job): Promise<TicketEmailResult> {
    const payload = sendTicketEmailPayloadSchema.safeParse(job.data);
    if (!payload.success) {
      // Tentar de novo não muda o payload: vai direto para failed, com log de erro.
      throw new UnrecoverableError(`Payload inválido: ${payload.error.message}`);
    }

    const result = await this.emails.sendForOrder(payload.data.orderId);
    if (result.status === 'skipped') {
      const fields = { message: 'Nenhum e-mail enviado', ...jobFields(job), reason: result.reason };
      if (result.reason === 'order-not-found') {
        this.logger.warn(fields);
      } else {
        // Reprocessamento ou ingressos anulados antes do envio: é o caminho normal.
        this.logger.log(fields);
      }
    }
    return result;
  }
}
