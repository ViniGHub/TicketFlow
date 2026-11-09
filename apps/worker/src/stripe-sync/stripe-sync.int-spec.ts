import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import {
  EXPIRE_ORDERS_JOB,
  RECONCILE_STRIPE_JOB,
  SEND_TICKET_EMAIL_JOB,
} from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { ExpirationService, StripeEventProcessor, StripeReconciler } from '@ticketflow/domain';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { PrismaUnitOfWork } from '@ticketflow/persistence';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { redisConnectionOptions } from '../queues/redis-connection';
import { WorkerModule } from '../worker.module';

import { JobSchedulers } from './job-schedulers';
import { StripeSyncService } from './stripe-sync.service';

// Expiração e reconciliação com Postgres e Redis reais (ROADMAP, etapa 5.3; ADR 0014). O
// Stripe é o FakePaymentGateway: nenhum teste fala com o Stripe.

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const gateway = new FakePaymentGateway();
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LOT_TOTAL = 10;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  await flushRedis(redisUrl);
  gateway.reset();
});

function stripeSync(): StripeSyncService {
  const uow = new PrismaUnitOfWork(prisma);
  return new StripeSyncService(
    new ExpirationService(uow, gateway),
    new StripeReconciler(uow, gateway, new StripeEventProcessor(uow)),
  );
}

let sequence = 0;

interface OrderSetup {
  /** Sessão no Stripe: aberta, ou já paga. Sem ela, o pedido não chegou a abrir o pagamento. */
  session?: 'open' | 'paid';
  createdAt?: Date;
  expiresAt?: Date;
}

/** Pedido `PENDING` de 2 ingressos, com o estoque já descontado do lote. */
async function pendingOrder({ session, createdAt, expiresAt }: OrderSetup = {}) {
  sequence += 1;
  const buyer = await prisma.user.create({
    data: {
      email: `comprador-${sequence}@teste.local`,
      name: 'Ana Compradora',
      passwordHash: '-',
      roles: ['BUYER'],
    },
  });
  const organizer = await prisma.user.create({
    data: {
      email: `organizador-${sequence}@teste.local`,
      name: 'Organizador',
      passwordHash: '-',
      roles: ['ORGANIZER'],
    },
  });
  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Show de Teste',
      description: '',
      venue: 'Teatro Municipal',
      timezone: 'America/Sao_Paulo',
      startsAt: new Date(Date.now() + 30 * DAY_MS),
      status: 'PUBLISHED',
    },
  });
  const lot = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 8_000,
      total: LOT_TOTAL,
      available: LOT_TOTAL - 2,
      maxPerOrder: 4,
      salesStart: new Date(Date.now() - DAY_MS),
      salesEnd: new Date(Date.now() + DAY_MS),
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: buyer.id,
      totalCents: 16_000,
      expiresAt: expiresAt ?? new Date(Date.now() + 15 * MINUTE_MS),
      ...(createdAt && { createdAt }),
      items: { create: { ticketTypeId: lot.id, quantity: 2, unitPriceCents: 8_000 } },
    },
  });

  let sessionId: string | null = null;
  if (session) {
    ({ id: sessionId } = await gateway.createCheckoutSession({
      orderId: order.id,
      lineItems: [{ name: 'Pista', unitPriceCents: 8_000, quantity: 2 }],
      expiresAt: order.expiresAt,
      orderCreatedAt: order.createdAt,
    }));
    await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: sessionId } });
    if (session === 'paid') {
      gateway.complete(sessionId);
    }
  }
  return { orderId: order.id, lotId: lot.id, sessionId };
}

async function stateOf(orderId: string, lotId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const lot = await prisma.ticketType.findUniqueOrThrow({ where: { id: lotId } });
  return {
    status: order.status,
    paidAt: order.paidAt,
    paymentIntentId: order.stripePaymentIntentId,
    available: lot.available,
    tickets: await prisma.ticket.count({ where: { orderId } }),
    emails: await prisma.outbox.count({ where: { type: SEND_TICKET_EMAIL_JOB } }),
  };
}

const vencido = () => ({ expiresAt: new Date(Date.now() - MINUTE_MS) });

describe('expire-orders', () => {
  it('sessão paga na expiração: o pedido vira PAID e o estoque não volta', async () => {
    const { orderId, lotId, sessionId } = await pendingOrder({ session: 'paid', ...vencido() });

    const report = await stripeSync().expireOrders(new Date());

    expect(report.expired).toEqual([]);
    expect(report.paid).toEqual([
      { orderId, result: { status: 'processed', orderId, orderStatus: 'PAID' } },
    ]);
    const state = await stateOf(orderId, lotId);
    expect(state).toMatchObject({
      status: 'PAID',
      paymentIntentId: `pi_test_${sessionId}`,
      available: LOT_TOTAL - 2,
      tickets: 2,
      emails: 1,
    });
    expect(state.paidAt).not.toBeNull();
    // O mesmo caminho do webhook, com o evento sintético registrado.
    const events = await prisma.stripeEvent.findMany();
    expect(events.map(({ eventId, type }) => ({ eventId, type }))).toEqual([
      { eventId: `reconcile:${sessionId}:complete:paid`, type: 'checkout.session.completed' },
    ]);
  });

  it('pedido sem sessão expira e devolve o estoque, sem chamar o Stripe', async () => {
    const { orderId, lotId } = await pendingOrder(vencido());

    const report = await stripeSync().expireOrders(new Date());

    expect(report.expired).toEqual([orderId]);
    expect(await stateOf(orderId, lotId)).toMatchObject({
      status: 'EXPIRED',
      available: LOT_TOTAL,
      tickets: 0,
    });
    expect(gateway.expireCalls).toEqual([]);
  });

  it('sessão aberta: expira a sessão no Stripe antes de devolver o estoque', async () => {
    const { orderId, lotId, sessionId } = await pendingOrder({ session: 'open', ...vencido() });

    await stripeSync().expireOrders(new Date());

    expect(gateway.expireCalls).toEqual([sessionId]);
    expect(gateway.session(sessionId ?? '')?.status).toBe('expired');
    expect(await stateOf(orderId, lotId)).toMatchObject({
      status: 'EXPIRED',
      available: LOT_TOTAL,
    });
  });
});

describe('reconcile-stripe', () => {
  it('aplica um pagamento cujo webhook não chegou, uma vez só', async () => {
    const { orderId, lotId } = await pendingOrder({
      session: 'paid',
      createdAt: new Date(Date.now() - 20 * MINUTE_MS),
    });
    const sync = stripeSync();

    const summary = await sync.reconcile(new Date());

    expect(summary).toEqual({
      reconciled: [{ orderId, result: { status: 'processed', orderId, orderStatus: 'PAID' } }],
      failed: [],
    });
    expect(await stateOf(orderId, lotId)).toMatchObject({
      status: 'PAID',
      available: LOT_TOTAL - 2,
      tickets: 2,
      emails: 1,
    });

    // O pedido saiu de PENDING: a próxima execução nem o consulta.
    await expect(sync.reconcile(new Date())).resolves.toEqual({ reconciled: [], failed: [] });
    expect(await stateOf(orderId, lotId)).toMatchObject({ tickets: 2, emails: 1 });
  });

  it('pedido criado há menos de 10 min fica de fora: o webhook ainda pode chegar', async () => {
    await pendingOrder({ session: 'paid' });

    await expect(stripeSync().reconcile(new Date())).resolves.toEqual({
      reconciled: [],
      failed: [],
    });
    expect(gateway.retrieveCalls).toEqual([]);
  });
});

describe('worker de pé', () => {
  let dir: string;
  const queues: Queue[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-sync-'));
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close()));
    await rm(dir, { recursive: true, force: true });
  });

  function startWorker(name: string) {
    return NestFactory.createApplicationContext(
      WorkerModule.register({
        databaseUrl,
        redisUrl,
        heartbeat: { file: join(dir, `${name}.heartbeat`), intervalMs: 60_000 },
        relay: { intervalMs: 60_000 },
        email: {
          from: 'ingressos@ticketflow.local',
          smtp: { host: '127.0.0.1', port: 1 },
          sender: { send: () => Promise.resolve() },
        },
        payments: { gateway },
      }),
      { logger: false },
    );
  }

  function queue(name: string): Queue {
    const created = new Queue(name, { connection: redisConnectionOptions(redisUrl) });
    queues.push(created);
    return created;
  }

  it('duas réplicas registram um scheduler por job, e o expire-orders roda', async () => {
    const { orderId, lotId } = await pendingOrder(vencido());
    const apps = await Promise.all([startWorker('replica-1'), startWorker('replica-2')]);
    try {
      await Promise.all(apps.map((app) => app.get(JobSchedulers).registration));

      const expire = queue(EXPIRE_ORDERS_JOB);
      const reconcile = queue(RECONCILE_STRIPE_JOB);
      const schedulersOf = async (target: Queue) =>
        (await target.getJobSchedulers()).map(({ key, name, every }) => ({ key, name, every }));
      expect(await schedulersOf(expire)).toEqual([
        { key: EXPIRE_ORDERS_JOB, name: EXPIRE_ORDERS_JOB, every: 60_000 },
      ]);
      expect(await schedulersOf(reconcile)).toEqual([
        { key: RECONCILE_STRIPE_JOB, name: RECONCILE_STRIPE_JOB, every: 15 * 60_000 },
      ]);

      // O BullMQ dispara a primeira execução de um scheduler `every` na hora; um job avulso
      // garante a execução sem depender disso.
      await expire.add(EXPIRE_ORDERS_JOB, {});
      await eventually(async () => (await stateOf(orderId, lotId)).status === 'EXPIRED');
    } finally {
      await Promise.all(apps.map((app) => app.close()));
    }

    expect(await stateOf(orderId, lotId)).toMatchObject({ available: LOT_TOTAL });
  });
});

/** Repete `check` até ele dar verdadeiro ou o prazo acabar. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`Condição não atendida em ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
