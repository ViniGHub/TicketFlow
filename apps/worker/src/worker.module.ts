import { type DynamicModule, Module } from '@nestjs/common';

import {
  HEARTBEAT_OPTIONS,
  HeartbeatService,
  type HeartbeatOptions,
} from './heartbeat/heartbeat.service';

export interface WorkerModuleOptions {
  heartbeat: HeartbeatOptions;
}

@Module({})
export class WorkerModule {
  static register(options: WorkerModuleOptions): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: HEARTBEAT_OPTIONS, useValue: options.heartbeat }, HeartbeatService],
    };
  }
}
