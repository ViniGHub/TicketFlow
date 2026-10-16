import { type DynamicModule, Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import {
  HEARTBEAT_OPTIONS,
  HeartbeatService,
  type HeartbeatOptions,
} from './heartbeat/heartbeat.service';

export interface WorkerModuleOptions {
  databaseUrl: string;
  heartbeat: HeartbeatOptions;
}

@Module({})
export class WorkerModule {
  static register(options: WorkerModuleOptions): DynamicModule {
    return {
      module: WorkerModule,
      imports: [DatabaseModule.forRoot({ url: options.databaseUrl })],
      providers: [{ provide: HEARTBEAT_OPTIONS, useValue: options.heartbeat }, HeartbeatService],
    };
  }
}
