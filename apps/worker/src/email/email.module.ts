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

export interface EmailModuleOptions extends EmailSenderConfig {
  /** Transporte pronto, no lugar do escolhido pela configuração; os testes passam um fake. */
  sender?: EmailSender;
}

/** Fecha a conexão SMTP no fim do shutdown, depois de os consumidores terminarem o job em curso. */
@Injectable()
class EmailSenderLifecycle implements OnApplicationShutdown {
  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  onApplicationShutdown(): void {
    this.sender.close?.();
  }
}

/**
 * Transporte de e-mail do worker (ADR 0013): Resend com `RESEND_API_KEY`, SMTP sem ela. Um só
 * para todos os e-mails (ingressos, evento cancelado).
 */
@Module({})
export class EmailModule {
  static forRoot({ sender, ...config }: EmailModuleOptions): DynamicModule {
    return {
      module: EmailModule,
      global: true,
      providers: [
        { provide: EMAIL_SENDER, useFactory: () => sender ?? createEmailSender(config) },
        EmailSenderLifecycle,
      ],
      exports: [EMAIL_SENDER],
    };
  }
}
