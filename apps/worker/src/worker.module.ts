import { type DynamicModule, Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { EmailModule, type EmailModuleOptions } from './email/email.module';
import { EventCancelledEmailModule } from './event-cancelled-email/event-cancelled-email.module';
import {
  HEARTBEAT_OPTIONS,
  HeartbeatService,
  type HeartbeatOptions,
} from './heartbeat/heartbeat.service';
import { OutboxModule, type OutboxModuleOptions } from './outbox/outbox.module';
import { PaymentsModule, type PaymentsModuleOptions } from './payments/payments.module';
import { QueuesModule } from './queues/queues.module';
import { RefundsModule } from './refunds/refunds.module';
import { StripeSyncModule } from './stripe-sync/stripe-sync.module';
import { TicketEmailModule } from './ticket-email/ticket-email.module';

export interface WorkerModuleOptions {
  databaseUrl: string;
  redisUrl: string;
  heartbeat: HeartbeatOptions;
  /** Ritmo e tamanho do lote do relay da outbox; os testes encurtam o intervalo. */
  relay?: OutboxModuleOptions;
  /** Remetente e transporte dos e-mails. */
  email: EmailModuleOptions;
  /** Stripe, para a expiração e a reconciliação; os testes passam um gateway de mentira. */
  payments: PaymentsModuleOptions;
}

@Module({})
export class WorkerModule {
  static register(options: WorkerModuleOptions): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        DatabaseModule.forRoot({ url: options.databaseUrl }),
        QueuesModule.forRoot({ redisUrl: options.redisUrl }),
        OutboxModule.forRoot(options.relay),
        PaymentsModule.forRoot(options.payments),
        EmailModule.forRoot(options.email),
        TicketEmailModule,
        EventCancelledEmailModule,
        RefundsModule,
        StripeSyncModule,
      ],
      providers: [{ provide: HEARTBEAT_OPTIONS, useValue: options.heartbeat }, HeartbeatService],
    };
  }
}
