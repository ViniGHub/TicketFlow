import { Logger } from '@nestjs/common';
import { type OutboxJobType } from '@ticketflow/contracts';
import { type Queue } from 'bullmq';

export interface JobToPublish {
  type: OutboxJobType;
  /** O id da linha da outbox: publicar a mesma linha de novo não cria outro job. */
  jobId: string;
  payload: unknown;
}

/** Publica jobs nas filas. O relay da outbox depende só disto; os testes trocam a implementação. */
export interface JobPublisher {
  publish(job: JobToPublish): Promise<void>;
}

export const JOB_PUBLISHER = Symbol('JOB_PUBLISHER');

/**
 * Limite de uma publicação. O relay publica com a linha da outbox travada: uma publicação que
 * ficasse esperando o Redis seguraria a transação.
 */
export const PUBLISH_TIMEOUT_MS = 5_000;

/** Uma fila do BullMQ por tipo de job, com o mesmo nome. */
export class BullMqJobPublisher implements JobPublisher {
  private readonly queues: Map<string, Queue>;

  constructor(
    queues: readonly Queue[],
    private readonly timeoutMs = PUBLISH_TIMEOUT_MS,
    private readonly logger = new Logger(BullMqJobPublisher.name),
  ) {
    this.queues = new Map(queues.map((queue) => [queue.name, queue]));
    for (const queue of queues) {
      // Sem ouvinte, um 'error' de conexão derrubaria o processo. A publicação que falhar
      // por isso já é tratada pelo relay.
      queue.on('error', (error) => {
        this.logger.warn({
          message: 'Erro de conexão da fila',
          queue: queue.name,
          error: error.message,
        });
      });
    }
  }

  async publish({ type, jobId, payload }: JobToPublish): Promise<void> {
    const queue = this.queues.get(type);
    if (!queue) {
      throw new Error(`Nenhuma fila registrada para o job ${type}.`);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Publicação do job ${jobId} passou de ${this.timeoutMs} ms.`)),
        this.timeoutMs,
      );
    });
    try {
      await Promise.race([queue.add(type, payload, { jobId }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
