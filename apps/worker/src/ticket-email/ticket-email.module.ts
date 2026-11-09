import { BullModule } from '@nestjs/bullmq';
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import {
  createEmailSender,
  EMAIL_SENDER,
  type EmailSender,
  type EmailSenderConfig,
} from './email-sender';
import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';

import { SendTicketEmailProcessor } from './send-ticket-email.processor';
import { TicketEmailService } from './ticket-email.service';

export interface TicketEmailModuleOptions extends EmailSenderConfig {
  /** Transporte pronto, no lugar do escolhido pela configuração; os testes passam um fake. */
  sender?: EmailSender;
}

/** Fecha a conexão SMTP no fim do shutdown, depois de o consumidor terminar o job em curso. */
@Injectable()
class EmailSenderLifecycle implements OnApplicationShutdown {
  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  onApplicationShutdown(): void {
    this.sender.close?.();
  }
}

/** E-mail com os ingressos do pedido pago (ROADMAP, etapa 5.2; ADR 0013). */
@Module({})
export class TicketEmailModule {
  static forRoot({ sender, ...config }: TicketEmailModuleOptions): DynamicModule {
    return {
      module: TicketEmailModule,
      // Registrar a fila é o que liga o consumidor: o BullModule.forRoot sozinho não traz o
      // explorer que transforma o @Processor num worker. Sem opções próprias, a fila usa a
      // conexão compartilhada dos consumidores (QueuesModule), que espera o Redis voltar.
      imports: [BullModule.registerQueue({ name: SEND_TICKET_EMAIL_JOB })],
      providers: [
        { provide: EMAIL_SENDER, useFactory: () => sender ?? createEmailSender(config) },
        EmailSenderLifecycle,
        TicketEmailService,
        SendTicketEmailProcessor,
      ],
    };
  }
}
