import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { OUTBOX_JOB_TYPES } from '@ticketflow/contracts';
import { Queue } from 'bullmq';

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
 * Filas do produtor, privadas do publicador. Não são registradas no BullModule de propósito:
 * o worker de um consumidor (`@Processor`) herdaria a conexão da fila registrada, e a do
 * produtor não espera o Redis voltar. Fecham na última fase do shutdown.
 */
export class OutboxQueues implements OnApplicationShutdown {
  readonly queues: Queue[];

  constructor(redisUrl: string) {
    this.queues = outboxQueueOptions(redisUrl).map(
      ({ name, ...options }) => new Queue(name, options),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}

/**
 * Conexão compartilhada dos consumidores (etapas 5.2 em diante), que espera o Redis voltar, e o
 * `JOB_PUBLISHER` do relay, sobre as filas do produtor.
 */
@Module({})
export class QueuesModule {
  static forRoot({ redisUrl }: QueuesModuleOptions): DynamicModule {
    return {
      module: QueuesModule,
      global: true,
      imports: [BullModule.forRoot({ connection: redisConnectionOptions(redisUrl) })],
      providers: [
        { provide: OutboxQueues, useFactory: () => new OutboxQueues(redisUrl) },
        {
          provide: JOB_PUBLISHER,
          inject: [OutboxQueues],
          useFactory: ({ queues }: OutboxQueues) => new BullMqJobPublisher(queues),
        },
      ],
      exports: [JOB_PUBLISHER],
    };
  }
}
