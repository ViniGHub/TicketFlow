import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { type ApiEnv } from './config/env';
import { EnvModule } from './config/env.module';
import { loggerParams } from './config/logger';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { OrdersModule } from './orders/orders.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { OriginGuard } from './security/origin.guard';
import { RedisThrottlerStorage } from './security/redis-throttler.storage';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot(loggerParams(env)),
        DatabaseModule.forRoot({ url: env.DATABASE_URL }),
        RedisModule.forRoot({ url: env.REDIS_URL }),
        // Limites por rota ficam nos controllers (@Throttle); o guard só entra onde é usado.
        ThrottlerModule.forRootAsync({
          inject: [REDIS],
          useFactory: (redis: Redis) => ({
            throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
            storage: new RedisThrottlerStorage(redis),
          }),
        }),
        HealthModule,
        AuthModule,
        EventsModule,
        OrdersModule,
        WebhooksModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_GUARD, useClass: OriginGuard },
      ],
    };
  }
}
