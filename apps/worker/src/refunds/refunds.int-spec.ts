import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { createPrismaClient } from '@ticketflow/db';
import {
  cancelEvent,
  CHARGE_REFUNDED,
  ExpirationService,
  refundOrder,
  StripeEventProcessor,
  StripeReconciler,
} from '@ticketflow/domain';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { PrismaUnitOfWork } from '@ticketflow/persistence';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { type EmailMessage } from '../email/email-message';
import { type EmailSender } from '../email/email-sender';
import { StripeSyncService } from '../stripe-sync/stripe-sync.service';
import { WorkerModule } from '../worker.module';

// Reembolso e cancelamento de evento com Postgres e Redis reais (ROADMAP, etapa 5.4;
// ADR 0015). O Stripe é o FakePaymentGateway: nenhum teste fala com o Stripe.

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const uow = new PrismaUnitOfWork(prisma);
const gateway = new FakePaymentGateway();
const DAY_MS = 24 * 60 * 60 * 1000;
const LOT_TOTAL = 10;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  await flushRedis(redisUrl);
  gateway.reset();
});

/** Transporte de mentira: guarda as mensagens. */
class FakeSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

let sequence = 0;

async function createUser(role: 'BUYER' | 'ORGANIZER'): Promise<string> {
  sequence += 1;
  const { id } = await prisma.user.create({
    data: {
      email: `usuario-${sequence}@teste.local`,
      name: 'Ana Compradora',
      passwordHash: '-',
      roles: [role],
    },
  });
  return id;
}

/** Evento publicado com um lote de 10 ingressos. */
async function createVenue() {
  const organizerId = await createUser('ORGANIZER');
  const event = await prisma.event.create({
    data: {
      organizerId,
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
      available: LOT_TOTAL,
      maxPerOrder: 4,
      salesStart: new Date(Date.now() - DAY_MS),
      salesEnd: new Date(Date.now() + DAY_MS),
    },
  });
  return { eventId: event.id, organizerId, lotId: lot.id };
}

type Venue = Awaited<ReturnType<typeof createVenue>>;

/** Pedido de 2 ingressos, com o estoque descontado. Pago, já tem PaymentIntent e ingressos. */
async function createOrder(venue: Venue, status: 'PAID' | 'PENDING') {
  const paid = status === 'PAID';
  const order = await prisma.order.create({
    data: {
      userId: await createUser('BUYER'),
      status,
      totalCents: 16_000,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      ...(paid && { paidAt: new Date() }),
      items: { create: { ticketTypeId: venue.lotId, quantity: 2, unitPriceCents: 8_000 } },
    },
  });
  await prisma.ticketType.update({
    where: { id: venue.lotId },
    data: { available: { decrement: 2 } },
  });
  const { id: sessionId } = await gateway.createCheckoutSession({
    orderId: order.id,
    lineItems: [{ name: 'Pista', unitPriceCents: 8_000, quantity: 2 }],
    expiresAt: order.expiresAt,
    orderCreatedAt: order.createdAt,
  });
  const paymentIntentId = `pi_test_${order.id}`;
  if (paid) {
    gateway.complete(sessionId, paymentIntentId);
    // qr_token de mentira, gerado em tempo de execução: nada com cara de segredo no código.
    await prisma.ticket.createMany({
      data: [0, 1].map((index) => ({
        orderId: order.id,
        ticketTypeId: venue.lotId,
        eventId: venue.eventId,
        qrToken: `ingresso-de-teste-${order.id}-${index}`,
      })),
    });
  }
  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: sessionId, ...(paid && { stripePaymentIntentId: paymentIntentId }) },
  });
  return { orderId: order.id, sessionId, paymentIntentId };
}

function cancel(venue: Venue) {
  return cancelEvent(uow, {
    eventId: venue.eventId,
    organizerId: venue.organizerId,
    now: new Date(),
  });
}

/** O `charge.refunded` que o Stripe manda depois do reembolso. */
function chargeRefunded(paymentIntentId: string) {
  return new StripeEventProcessor(uow).process({
    id: `evt_refund_${paymentIntentId}`,
    type: CHARGE_REFUNDED,
    createdAt: new Date(),
    session: null,
    charge: { id: `ch_${paymentIntentId}`, paymentIntentId, fullyRefunded: true },
  });
}

async function statusOf(orderId: string) {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

/** Repete `check` até ele dar verdadeiro ou o prazo acabar. */
async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`Condição não atendida em ${timeoutMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('cancelamento de evento, de ponta a ponta', () => {
  it('3 pedidos pagos geram 3 reembolsos, cada um executado uma vez, e 3 e-mails', async () => {
    const venue = await createVenue();
    const orders = await Promise.all([1, 2, 3].map(() => createOrder(venue, 'PAID')));
    await cancel(venue);

    const sender = new FakeSender();
    const dir = await mkdtemp(join(tmpdir(), 'worker-refunds-'));
    const app = await NestFactory.createApplicationContext(
      WorkerModule.register({
        databaseUrl,
        redisUrl,
        heartbeat: { file: join(dir, 'worker.heartbeat'), intervalMs: 60_000 },
        relay: { intervalMs: 200 },
        email: { from: 'ingressos@ticketflow.local', smtp: { host: '127.0.0.1', port: 1 }, sender },
        payments: { gateway },
      }),
      { logger: false },
    );
    try {
      await eventually(async () => {
        const pending = await prisma.outbox.count({ where: { publishedAt: null } });
        return pending === 0 && gateway.refunds.length === 3 && sender.sent.length === 3;
      });
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }

    const expected = orders.map(({ orderId, paymentIntentId }) => ({
      orderId,
      paymentIntentId,
      idempotencyKey: `refund:${orderId}`,
    }));
    const byOrder = <T extends { orderId: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.orderId.localeCompare(b.orderId));
    expect(byOrder(gateway.refundCalls)).toEqual(byOrder(expected));
    expect(sender.sent.map((message) => message.subject)).toEqual(
      Array(3).fill('Evento cancelado: Show de Teste'),
    );

    // O charge.refunded de cada um fecha o pedido; os ingressos já estavam anulados.
    for (const { orderId, paymentIntentId } of orders) {
      await chargeRefunded(paymentIntentId);
      expect(await statusOf(orderId)).toBe('REFUNDED');
    }
    const tickets = await prisma.ticket.findMany();
    expect(tickets).toHaveLength(6);
    expect(tickets.every((ticket) => ticket.voidedAt !== null)).toBe(true);
  });

  it('reserva pendente do evento cancelado expira no Stripe e devolve o estoque', async () => {
    const venue = await createVenue();
    const { orderId, sessionId } = await createOrder(venue, 'PENDING');
    await cancel(venue);
    const sync = new StripeSyncService(
      new ExpirationService(uow, gateway),
      new StripeReconciler(uow, gateway, new StripeEventProcessor(uow)),
    );

    const report = await sync.expireOrders(new Date());

    expect(report.expired).toEqual([orderId]);
    expect(gateway.session(sessionId)?.status).toBe('expired');
    expect(await statusOf(orderId)).toBe('EXPIRED');
    const lot = await prisma.ticketType.findUniqueOrThrow({ where: { id: venue.lotId } });
    expect(lot.available).toBe(LOT_TOTAL);
  });
});

describe('job refund-order', () => {
  it('repetido não gera reembolso duplicado, e depois do charge.refunded nem chama o Stripe', async () => {
    const venue = await createVenue();
    const { orderId, paymentIntentId } = await createOrder(venue, 'PAID');
    await cancel(venue);

    await expect(refundOrder(uow, gateway, orderId)).resolves.toEqual({
      status: 'refund-requested',
    });
    await expect(refundOrder(uow, gateway, orderId)).resolves.toEqual({
      status: 'refund-requested',
    });
    expect(gateway.refundCalls).toHaveLength(2);
    expect(gateway.refunds).toHaveLength(1);

    await chargeRefunded(paymentIntentId);
    await expect(refundOrder(uow, gateway, orderId)).resolves.toEqual({
      status: 'skipped',
      reason: 'already-refunded',
    });
    expect(gateway.refundCalls).toHaveLength(2);
  });

  it('falha do Stripe não muda o pedido, e a tentativa seguinte reembolsa', async () => {
    const venue = await createVenue();
    const { orderId } = await createOrder(venue, 'PAID');
    await cancel(venue);
    gateway.failNextRefund();

    await expect(refundOrder(uow, gateway, orderId)).rejects.toThrow(/indisponível/);
    expect(await statusOf(orderId)).toBe('REFUND_PENDING');

    await refundOrder(uow, gateway, orderId);
    expect(gateway.refunds).toHaveLength(1);
  });
});
