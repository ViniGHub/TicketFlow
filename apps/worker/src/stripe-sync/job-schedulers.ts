import { InjectQueue } from '@nestjs/bullmq';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EXPIRE_ORDERS_JOB, RECONCILE_STRIPE_JOB } from '@ticketflow/contracts';
import { type Queue } from 'bullmq';

import { SCHEDULED_JOB_OPTIONS } from '../queues/job-options';
import { errorMessage } from '../queues/logged-processor';

/** Jobs recorrentes e o intervalo de cada um (ARCHITECTURE.md, seção 8). */
export const JOB_SCHEDULES = [
  { name: EXPIRE_ORDERS_JOB, every: 60_000 },
  { name: RECONCILE_STRIPE_JOB, every: 15 * 60_000 },
] as const;

/** Espera entre as tentativas de registrar os schedulers com o Redis fora. */
export const SCHEDULER_RETRY_MS = 10_000;

/** O que o registro usa de cada fila. */
export type SchedulerQueue = Pick<Queue, 'name' | 'upsertJobScheduler'>;

/**
 * Cria ou atualiza o scheduler de cada job, com id fixo igual ao nome do job: subir de novo, ou
 * duas réplicas subindo juntas, não duplica o agendamento, e mudar o intervalo aqui atualiza o
 * que está no Redis.
 */
export async function upsertJobSchedulers(queues: readonly SchedulerQueue[]): Promise<void> {
  await Promise.all(
    JOB_SCHEDULES.map(({ name, every }) => {
      const queue = queues.find((candidate) => candidate.name === name);
      if (!queue) {
        throw new Error(`Fila ${name} não registrada.`);
      }
      return queue.upsertJobScheduler(name, { every }, { name, opts: SCHEDULED_JOB_OPTIONS });
    }),
  );
}

/**
 * Registra os schedulers na subida, sem segurá-la: com o Redis fora, o worker sobe mesmo assim
 * (o heartbeat continua), e o registro é tentado de novo a cada 10 s até dar certo.
 */
@Injectable()
export class JobSchedulers implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(JobSchedulers.name);
  private readonly queues: readonly SchedulerQueue[];
  private retryTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  /** A tentativa de registro em andamento. A subida não espera por ela; os testes, sim. */
  registration: Promise<void> = Promise.resolve();

  constructor(
    @InjectQueue(EXPIRE_ORDERS_JOB) expireOrders: SchedulerQueue,
    @InjectQueue(RECONCILE_STRIPE_JOB) reconcileStripe: SchedulerQueue,
  ) {
    this.queues = [expireOrders, reconcileStripe];
  }

  onApplicationBootstrap(): void {
    this.register();
  }

  beforeApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  private register(): void {
    this.registration = upsertJobSchedulers(this.queues).then(
      () => {
        this.logger.log({ message: 'Jobs recorrentes registrados', schedules: JOB_SCHEDULES });
      },
      (error: unknown) => {
        if (this.stopped) {
          return;
        }
        this.logger.warn({
          message: 'Falha ao registrar os jobs recorrentes; nova tentativa em instantes',
          retryInMs: SCHEDULER_RETRY_MS,
          error: errorMessage(error),
        });
        this.retryTimer = setTimeout(() => this.register(), SCHEDULER_RETRY_MS);
        this.retryTimer.unref();
      },
    );
  }
}
