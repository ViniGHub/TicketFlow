import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import {
  flushRedis,
  type StartedMailpit,
  startMailpit,
  truncateAllTables,
} from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { WorkerModule } from '../worker.module';

import { type EmailMessage } from '../email/email-message';
import { type EmailSender, SmtpEmailSender } from '../email/email-sender';

import { TicketEmailService } from './ticket-email.service';

// E-mail de ingressos com Postgres real (ROADMAP, etapa 5.2; ADR 0013).

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const FROM = 'ingressos@ticketflow.local';
const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  await flushRedis(redisUrl);
});

/** Transporte de mentira: guarda as mensagens; falha enquanto `failing` for verdadeiro. */
class FakeSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failing = false;

  send(message: EmailMessage): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('SMTP fora'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

let sequence = 0;

/** Pedido pago com `count` ingressos de um lote, como o webhook deixa (etapa 4.2). */
async function paidOrder(count: number) {
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
      startsAt: new Date('2026-12-20T23:00:00Z'),
      status: 'PUBLISHED',
    },
  });
  const lot = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 8_000,
      total: 10,
      available: 10 - count,
      maxPerOrder: 10,
      salesStart: new Date(Date.now() - DAY_MS),
      salesEnd: new Date(Date.now() + DAY_MS),
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: buyer.id,
      status: 'PAID',
      totalCents: 8_000 * count,
      expiresAt: new Date(Date.now() + DAY_MS),
      paidAt: new Date(),
      items: { create: { ticketTypeId: lot.id, quantity: count, unitPriceCents: 8_000 } },
    },
  });
  // qr_token de mentira, gerado em tempo de execução: nada com cara de segredo no código.
  await prisma.ticket.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      orderId: order.id,
      ticketTypeId: lot.id,
      eventId: event.id,
      qrToken: `ingresso-de-teste-${order.id}-${index}`,
    })),
  });
  return { orderId: order.id, buyerEmail: buyer.email };
}

async function emailedAtOf(orderId: string) {
  const tickets = await prisma.ticket.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
  return tickets.map((ticket) => ticket.emailedAt);
}

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

describe('e-mail de ingressos', () => {
  it('o transporte recebe um e-mail com N imagens, e todos os ingressos ficam enviados', async () => {
    const { orderId, buyerEmail } = await paidOrder(3);
    const sender = new FakeSender();
    const service = new TicketEmailService(prisma, sender);

    const result = await service.sendForOrder(orderId);

    expect(result).toEqual({ status: 'sent', tickets: 3 });
    expect(sender.sent).toHaveLength(1);
    const [message] = sender.sent;
    expect(message?.to.email).toBe(buyerEmail);
    expect(message?.subject).toBe('Seus ingressos para Show de Teste');
    expect(message?.images).toHaveLength(3);
    expect(message?.images.every((image) => image.contentType === 'image/png')).toBe(true);
    expect((await emailedAtOf(orderId)).every((emailedAt) => emailedAt !== null)).toBe(true);
  });

  it('reprocessar o job não reenvia', async () => {
    const { orderId } = await paidOrder(2);
    const sender = new FakeSender();
    const service = new TicketEmailService(prisma, sender);
    await service.sendForOrder(orderId);
    const firstSentAt = await emailedAtOf(orderId);

    const again = await service.sendForOrder(orderId);

    expect(again).toEqual({ status: 'skipped', reason: 'no-pending-tickets' });
    expect(sender.sent).toHaveLength(1);
    expect(await emailedAtOf(orderId)).toEqual(firstSentAt);
  });

  it('ingresso anulado não vai no e-mail nem ganha emailed_at', async () => {
    const { orderId } = await paidOrder(3);
    const [voided] = await prisma.ticket.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    await prisma.ticket.update({ where: { id: voided?.id }, data: { voidedAt: new Date() } });
    const sender = new FakeSender();

    await new TicketEmailService(prisma, sender).sendForOrder(orderId);

    expect(sender.sent[0]?.images).toHaveLength(2);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: voided?.id } });
    expect(stored.emailedAt).toBeNull();
  });

  it('pedido inexistente não envia nada', async () => {
    const sender = new FakeSender();

    const result = await new TicketEmailService(prisma, sender).sendForOrder(
      '0193a4f2-0000-7000-8000-0000000000ff',
    );

    expect(result).toEqual({ status: 'skipped', reason: 'order-not-found' });
    expect(sender.sent).toEqual([]);
  });

  it('transporte falhando: nada fica marcado, e a próxima tentativa envia', async () => {
    const { orderId } = await paidOrder(2);
    const sender = new FakeSender();
    sender.failing = true;
    const service = new TicketEmailService(prisma, sender);

    await expect(service.sendForOrder(orderId)).rejects.toThrow('SMTP fora');
    expect(await emailedAtOf(orderId)).toEqual([null, null]);

    sender.failing = false;
    await expect(service.sendForOrder(orderId)).resolves.toEqual({ status: 'sent', tickets: 2 });
  });
});

describe('entrega real pelo SMTP do Mailpit', () => {
  let mailpit: StartedMailpit;

  beforeAll(async () => {
    mailpit = await startMailpit();
  }, 120_000);

  afterAll(async () => {
    await mailpit?.stop();
  });

  it('a mensagem chega ao Mailpit com um QR por ingresso', async () => {
    const { orderId, buyerEmail } = await paidOrder(3);
    const sender = SmtpEmailSender.create({
      host: mailpit.smtpHost,
      port: mailpit.smtpPort,
      from: FROM,
    });

    try {
      await new TicketEmailService(prisma, sender).sendForOrder(orderId);
    } finally {
      sender.close();
    }

    const [summary] = await mailpit.messages();
    expect(summary?.Subject).toBe('Seus ingressos para Show de Teste');
    expect(summary?.To.map((to) => to.Address)).toEqual([buyerEmail]);
    const message = await mailpit.message(summary?.ID ?? '');
    const images = [...message.Inline, ...message.Attachments].filter(
      (part) => part.ContentType === 'image/png',
    );
    expect(images).toHaveLength(3);
    expect(message.Text).toContain('ingresso 3 de 3');
  });
});

describe('worker de pé', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-email-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('linha send-ticket-email na outbox vira e-mail enviado, de ponta a ponta', async () => {
    const { orderId } = await paidOrder(2);
    const sender = new FakeSender();
    const app = await NestFactory.createApplicationContext(
      WorkerModule.register({
        databaseUrl,
        redisUrl,
        heartbeat: { file: join(dir, 'worker.heartbeat'), intervalMs: 60_000 },
        relay: { intervalMs: 200 },
        email: { from: FROM, smtp: { host: '127.0.0.1', port: 1 }, sender },
        payments: { gateway: new FakePaymentGateway() },
      }),
      { logger: false },
    );
    try {
      await prisma.outbox.create({ data: { type: SEND_TICKET_EMAIL_JOB, payload: { orderId } } });

      await eventually(async () =>
        (await emailedAtOf(orderId)).every((emailedAt) => emailedAt !== null),
      );
    } finally {
      await app.close();
    }

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.images).toHaveLength(2);
  });
});
