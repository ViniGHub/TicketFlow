import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

/**
 * Base dos consumidores das filas (a partir da etapa 5.2). Cada conclusão e cada falha de job
 * vai para o log com `jobId` e `orderId` (ARCHITECTURE.md, seção 8). Falha com tentativas
 * sobrando é `warn`: o BullMQ tenta de novo com backoff. Na última tentativa é `error`: o job
 * fica em `failed`, a dead-letter, até alguém olhar.
 */
export abstract class LoggedProcessor extends WorkerHost {
  protected readonly logger: Logger;

  constructor(logger?: Logger) {
    super();
    this.logger = logger ?? new Logger(new.target.name);
  }

  @OnWorkerEvent('completed')
  onJobCompleted(job: Job): void {
    this.logger.log({ message: 'Job concluído', ...jobFields(job) });
  }

  @OnWorkerEvent('failed')
  onJobFailed(job: Job | undefined, error: Error): void {
    if (!job) {
      // O BullMQ não achou o job (ex.: removido no meio): não há o que repetir.
      this.logger.error({ message: 'Job falhou sem registro', error: error.message });
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const fields = {
      ...jobFields(job),
      attempt: job.attemptsMade,
      attempts,
      error: error.message,
    };
    if (job.attemptsMade >= attempts) {
      this.logger.error({ message: 'Job esgotou as tentativas e ficou em failed', ...fields });
    } else {
      this.logger.warn({ message: 'Job falhou; o BullMQ tenta de novo', ...fields });
    }
  }
}

/** `jobId`, fila e, quando o payload tem, `orderId`. */
export function jobFields(job: Job): Record<string, string> {
  const fields: Record<string, string> = { jobId: job.id ?? '', queue: job.queueName };
  const data: unknown = job.data;
  if (data && typeof data === 'object' && 'orderId' in data && typeof data.orderId === 'string') {
    fields['orderId'] = data.orderId;
  }
  return fields;
}
