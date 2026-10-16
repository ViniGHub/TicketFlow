import { type DynamicModule, Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

export interface AppModuleOptions {
  databaseUrl: string;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot({ url: options.databaseUrl }), HealthModule],
    };
  }
}
