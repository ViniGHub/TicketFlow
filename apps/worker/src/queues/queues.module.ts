import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { OUTBOX_JOB_TYPES } from '@ticketflow/contracts';
import { type Queue } from 'bullmq';

import { DEFAULT_JOB_OPTIONS } from './job-options';
import { BullMqJobPublisher, JOB_PUBLISHER } from './job-publisher';
import { redisConnectionOptions } from './redis-connection';

export interface QueuesModuleOptions {
  redisUrl: string;
}

/**
 * Filas do BullMQ, uma por tipo de job da outbox, e o `JOB_PUBLISHER` que publica nelas. As
 * filas fecham na última fase do shutdown (`onApplicationShutdown`).
 */
@Module({})
export class QueuesModule {
  static forRoot({ redisUrl }: QueuesModuleOptions): DynamicModule {
    const connection = redisConnectionOptions(redisUrl);
    return {
      module: QueuesModule,
      global: true,
      imports: [
        // Conexão dos consumidores (etapas 5.2 em diante): esperam o Redis voltar.
        BullModule.forRoot({ connection }),
        BullModule.registerQueue(
          ...OUTBOX_JOB_TYPES.map((name) => ({
            name,
            // Conexão do produtor: com o Redis fora, publicar falha na hora, sem fila offline.
            connection: { ...connection, enableOfflineQueue: false },
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
          })),
        ),
      ],
      providers: [
        {
          provide: JOB_PUBLISHER,
          inject: OUTBOX_JOB_TYPES.map((name) => getQueueToken(name)),
          useFactory: (...queues: Queue[]) => new BullMqJobPublisher(queues),
        },
      ],
      exports: [JOB_PUBLISHER],
    };
  }
}
