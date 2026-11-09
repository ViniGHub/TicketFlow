import { type DynamicModule, Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import {
  HEARTBEAT_OPTIONS,
  HeartbeatService,
  type HeartbeatOptions,
} from './heartbeat/heartbeat.service';
import { OutboxModule, type OutboxModuleOptions } from './outbox/outbox.module';
import { PaymentsModule, type PaymentsModuleOptions } from './payments/payments.module';
import { QueuesModule } from './queues/queues.module';
import { StripeSyncModule } from './stripe-sync/stripe-sync.module';
import {
  TicketEmailModule,
  type TicketEmailModuleOptions,
} from './ticket-email/ticket-email.module';

export interface WorkerModuleOptions {
  databaseUrl: string;
  redisUrl: string;
  heartbeat: HeartbeatOptions;
  /** Ritmo e tamanho do lote do relay da outbox; os testes encurtam o intervalo. */
  relay?: OutboxModuleOptions;
  /** Remetente e transporte do e-mail de ingressos. */
  email: TicketEmailModuleOptions;
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
        TicketEmailModule.forRoot(options.email),
        StripeSyncModule,
      ],
      providers: [{ provide: HEARTBEAT_OPTIONS, useValue: options.heartbeat }, HeartbeatService],
    };
  }
}
