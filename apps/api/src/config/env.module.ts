import { type DynamicModule, Global, Module } from '@nestjs/common';

import { type ApiEnv } from './env';
import { API_ENV } from './env.token';

/** Disponibiliza as variáveis de ambiente validadas para toda a aplicação. */
@Global()
@Module({})
export class EnvModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}
