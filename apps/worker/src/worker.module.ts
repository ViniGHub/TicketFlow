import { type DynamicModule, Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import {
  HEARTBEAT_OPTIONS,
  HeartbeatService,
  type HeartbeatOptions,
} from './heartbeat/heartbeat.service';
import { OutboxModule, type OutboxModuleOptions } from './outbox/outbox.module';
import { QueuesModule } from './queues/queues.module';

export interface WorkerModuleOptions {
  databaseUrl: string;
  redisUrl: string;
  heartbeat: HeartbeatOptions;
  /** Ritmo e tamanho do lote do relay da outbox; os testes encurtam o intervalo. */
  relay?: OutboxModuleOptions;
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
      ],
      providers: [{ provide: HEARTBEAT_OPTIONS, useValue: options.heartbeat }, HeartbeatService],
    };
  }
}
