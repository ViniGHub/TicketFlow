import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BullModule, Processor } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { REFUND_ORDER_JOB, SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';
import { createPrismaClient, type PrismaClient } from '@ticketflow/db';
import { flushRedis, startTcpProxy, type TcpProxy, truncateAllTables } from '@ticketflow/testing';
import { type Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { BullMqJobPublisher, type JobPublisher, type JobToPublish } from '../queues/job-publisher';
import { LoggedProcessor } from '../queues/logged-processor';
import { outboxQueueOptions } from '../queues/queues.module';
import { redisConnectionOptions } from '../queues/redis-connection';
import { WorkerModule } from '../worker.module';

import { OutboxRelay } from './outbox-relay';
import { PrismaOutboxStore } from './outbox-store';

// Relay da outbox com Postgres e Redis reais (ROADMAP, etapa 5.1; ADR 0012).

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

/** Filas abertas por um teste, fechadas no afterEach. */
let openQueues: Queue[] = [];

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  await flushRedis(redisUrl);
});

afterEach(async () => {
  await Promise.all(openQueues.map((queue) => queue.close()));
  openQueues = [];
  vi.restoreAllMocks();
});

/** As filas da outbox com as opções do worker, apontando para `url`. */
function queuesFor(url: string): Queue[] {
  const queues = outboxQueueOptions(url).map(({ name, ...options }) => new Queue(name, options));
  openQueues.push(...queues);
  return queues;
}

function queueNamed(queues: Queue[], name: string): Queue {
  const queue = queues.find((candidate) => candidate.name === name);
  if (!queue) {
    throw new Error(`Fila ${name} não aberta.`);
  }
  return queue;
}

async function insertOutbox(count: number, type = SEND_TICKET_EMAIL_JOB) {
  await prisma.outbox.createMany({
    data: Array.from({ length: count }, () => ({ type, payload: { orderId: randomUUID() } })),
  });
  return prisma.outbox.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Repete `check` até ele dar verdadeiro ou o prazo acabar. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`Condição não atendida em ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Conta as publicações por jobId, com uma pausa que faz as transações dos relays se cruzarem. */
class CountingPublisher implements JobPublisher {
  readonly calls = new Map<string, number>();

  constructor(private readonly inner: JobPublisher) {}

  async publish(job: JobToPublish): Promise<void> {
    this.calls.set(job.jobId, (this.calls.get(job.jobId) ?? 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await this.inner.publish(job);
  }
}

/** Publica tudo o que estiver pendente, lote a lote, até um lote vir vazio. */
async function drain(relay: OutboxRelay): Promise<void> {
  while ((await relay.relayBatch()).published > 0) {
    // próximo lote
  }
}

describe('relay da outbox', () => {
  it('dois relays ao mesmo tempo publicam cada linha uma vez só', async () => {
    const rows = await insertOutbox(50);
    const queues = queuesFor(redisUrl);
    const publisher = new CountingPublisher(new BullMqJobPublisher(queues, 5_000, silentLogger));
    // Dois clientes Prisma, como dois workers rodando ao mesmo tempo.
    const otherPrisma: PrismaClient = createPrismaClient(databaseUrl);
    const relays = [prisma, otherPrisma].map(
      (client) =>
        new OutboxRelay(new PrismaOutboxStore(client), publisher, 10, undefined, silentLogger),
    );

    try {
      await Promise.all(relays.map((relay) => drain(relay)));
    } finally {
      await otherPrisma.$disconnect();
    }

    expect(publisher.calls.size).toBe(50);
    expect([...publisher.calls.values()].every((count) => count === 1)).toBe(true);
    const pending = await prisma.outbox.count({ where: { publishedAt: null } });
    expect(pending).toBe(0);
    const queue = queueNamed(queues, SEND_TICKET_EMAIL_JOB);
    expect(await queue.getJobCountByTypes('waiting', 'delayed', 'active')).toBe(50);
    const job = await queue.getJob(rows[0]?.id ?? '');
    expect(job?.data).toEqual(rows[0]?.payload);
  });

  describe('com o Redis fora antes da publicação', () => {
    let proxy: TcpProxy;

    beforeEach(async () => {
      const { hostname, port } = new URL(redisUrl);
      proxy = await startTcpProxy({ host: hostname, port: Number(port) });
    });

    afterEach(async () => {
      await proxy.close();
    });

    it('a linha fica pendente e é publicada quando o Redis volta', async () => {
      const queues = queuesFor(proxy.urlFor(redisUrl));
      await Promise.all(queues.map((queue) => queue.waitUntilReady()));
      const relay = new OutboxRelay(
        new PrismaOutboxStore(prisma),
        new BullMqJobPublisher(queues, 2_000, silentLogger),
        100,
        undefined,
        silentLogger,
      );
      const [row] = await insertOutbox(1, REFUND_ORDER_JOB);

      await proxy.stop();
      const down = await relay.relayBatch();

      expect(down).toEqual({ published: 0, failed: 1, full: false });
      expect(await prisma.outbox.findUnique({ where: { id: row?.id } })).toMatchObject({
        publishedAt: null,
        attempts: 1,
      });

      await proxy.start();
      // O ioredis reconecta sozinho; até lá, cada ciclo falha de novo e espera o próximo.
      await eventually(async () => (await relay.relayBatch()).published === 1);

      const stored = await prisma.outbox.findUnique({ where: { id: row?.id } });
      expect(stored?.publishedAt).not.toBeNull();
      const [direct] = queuesFor(redisUrl).filter((queue) => queue.name === REFUND_ORDER_JOB);
      expect(await direct?.getJob(row?.id ?? '')).toBeDefined();
    });
  });

  describe('worker de pé', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'worker-relay-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('uma linha nova vira job em até 2 s, com as tentativas e o backoff configurados', async () => {
      const app = await NestFactory.createApplicationContext(
        WorkerModule.register({
          databaseUrl,
          redisUrl,
          heartbeat: { file: join(dir, 'worker.heartbeat'), intervalMs: 60_000 },
          relay: { intervalMs: 1_000 },
          // O consumidor da 5.2 também sobe: o pedido do payload não existe, e ele não envia nada.
          email: {
            from: 'ingressos@ticketflow.local',
            smtp: { host: '127.0.0.1', port: 1 },
            sender: { send: () => Promise.resolve() },
          },
        }),
        { logger: false },
      );
      const [queue] = queuesFor(redisUrl).filter((q) => q.name === SEND_TICKET_EMAIL_JOB);
      try {
        const [row] = await insertOutbox(1);
        const insertedAt = Date.now();

        let job: Job | undefined;
        await eventually(async () => {
          job = await queue?.getJob(row?.id ?? '');
          return job !== undefined;
        }, 5_000);

        expect(Date.now() - insertedAt).toBeLessThan(2_000);
        expect(job?.opts).toMatchObject({
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
        });
      } finally {
        await app.close();
      }
    });
  });
});

/** Consumidor que sempre falha, para ver o log da última tentativa. */
@Processor(REFUND_ORDER_JOB)
class AlwaysFailingProcessor extends LoggedProcessor {
  process(): Promise<void> {
    return Promise.reject(new Error('falha de teste'));
  }
}

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnectionOptions(inject('redisUrl')) }),
    BullModule.registerQueue({ name: REFUND_ORDER_JOB }),
  ],
  providers: [AlwaysFailingProcessor],
})
class FailingJobsModule {}

describe('consumidor com log de falhas', () => {
  it('job que esgota as tentativas fica em failed, com aviso antes e erro no fim', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const app = await NestFactory.createApplicationContext(FailingJobsModule, { logger: false });
    const [queue] = queuesFor(redisUrl).filter((q) => q.name === REFUND_ORDER_JOB);
    const orderId = randomUUID();
    try {
      await queue?.add(
        REFUND_ORDER_JOB,
        { orderId },
        { jobId: 'job-de-teste', attempts: 2, backoff: { type: 'fixed', delay: 10 } },
      );

      await eventually(
        async () =>
          (await queue?.getJob('job-de-teste'))?.failedReason !== undefined &&
          (await queue?.getJobState('job-de-teste')) === 'failed',
      );
    } finally {
      await app.close();
    }

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-de-teste', orderId, attempt: 1, attempts: 2 }),
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Job esgotou as tentativas e ficou em failed',
        jobId: 'job-de-teste',
        orderId,
        attempt: 2,
      }),
    );
  });
});
