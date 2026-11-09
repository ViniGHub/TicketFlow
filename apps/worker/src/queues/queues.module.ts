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
 * Opções de cada fila em que o relay publica: o nome é o tipo do job. A conexão é a do
 * produtor: com o Redis fora, publicar falha na hora, sem fila offline. Os testes de
 * integração montam as filas com estas mesmas opções.
 */
export function outboxQueueOptions(redisUrl: string) {
  const connection = { ...redisConnectionOptions(redisUrl), enableOfflineQueue: false };
  return OUTBOX_JOB_TYPES.map((name) => ({
    name,
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  }));
}

/**
 * Filas do BullMQ, uma por tipo de job da outbox, e o `JOB_PUBLISHER` que publica nelas. As
 * filas fecham na última fase do shutdown (`onApplicationShutdown`).
 */
@Module({})
export class QueuesModule {
  static forRoot({ redisUrl }: QueuesModuleOptions): DynamicModule {
    return {
      module: QueuesModule,
      global: true,
      imports: [
        // Conexão dos consumidores (etapas 5.2 em diante): esperam o Redis voltar.
        BullModule.forRoot({ connection: redisConnectionOptions(redisUrl) }),
        BullModule.registerQueue(...outboxQueueOptions(redisUrl)),
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
