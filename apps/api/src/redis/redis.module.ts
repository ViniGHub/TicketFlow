import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';

/** Token de injeção do client do Redis (`@Inject(REDIS) redis: Redis`). */
export const REDIS = Symbol('REDIS');

export interface RedisModuleOptions {
  url: string;
}

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // Falha rápido com o Redis fora, em vez de segurar a requisição: o /health/ready acusa.
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  private available = true;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    // Sem listener, o ioredis imprime cada falha de reconexão. Loga só as mudanças de estado.
    redis.on('error', (error: Error) => {
      if (this.available) {
        this.available = false;
        this.logger.warn(`Redis indisponível: ${error.message}`);
      }
    });
    redis.on('ready', () => {
      if (!this.available) {
        this.logger.log('Redis disponível novamente');
      }
      this.available = true;
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}

/** Disponibiliza um client do Redis compartilhado (rate limit; filas na fase 5). */
@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        { provide: REDIS, useFactory: () => createRedisClient(options.url) },
        RedisLifecycle,
      ],
      exports: [REDIS],
    };
  }
}
