import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';

import { SendTicketEmailProcessor } from './send-ticket-email.processor';
import { TicketEmailService } from './ticket-email.service';

/** E-mail com os ingressos do pedido pago (ROADMAP, etapa 5.2; ADR 0013). */
@Module({
  // Registrar a fila é o que liga o consumidor: o BullModule.forRoot sozinho não traz o
  // explorer que transforma o @Processor num worker. Sem opções próprias, a fila usa a
  // conexão compartilhada dos consumidores (QueuesModule), que espera o Redis voltar. O
  // transporte vem do EmailModule.
  imports: [BullModule.registerQueue({ name: SEND_TICKET_EMAIL_JOB })],
  providers: [TicketEmailService, SendTicketEmailProcessor],
})
export class TicketEmailModule {}
