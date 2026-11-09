import { type DefaultJobOptions } from 'bullmq';

// Opções de todo job publicado pelo relay (ARCHITECTURE.md, seção 8; ADR 0012).

const DAY_SECONDS = 24 * 60 * 60;

export const JOB_ATTEMPTS = 5;

export const DEFAULT_JOB_OPTIONS = {
  /** 5 tentativas, com espera de 2 s, 4 s, 8 s e 16 s entre elas. */
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 2_000 },
  /**
   * Job concluído fica 7 dias no Redis: enquanto ele existe, o BullMQ ignora outra publicação
   * com o mesmo `jobId` (a mesma linha da outbox publicada de novo). Depois disso, quem garante
   * é a idempotência do job.
   */
  removeOnComplete: { age: 7 * DAY_SECONDS },
  /** Job esgotado fica em `failed` (a dead-letter do BullMQ) até alguém olhar. */
  removeOnFail: false,
} as const satisfies DefaultJobOptions;
