import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isHeartbeatFresh } from './heartbeat/heartbeat';
import { HeartbeatService } from './heartbeat/heartbeat.service';
import { SendTicketEmailProcessor } from './ticket-email/send-ticket-email.processor';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-'));
    file = join(dir, 'worker.heartbeat');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sobe gravando o heartbeat e, ao encerrar, para o timer e remove o arquivo', async () => {
    const app = await NestFactory.createApplicationContext(
      WorkerModule.register({
        // O Prisma só conecta na primeira consulta: a URL não precisa apontar para um banco real.
        databaseUrl: 'postgresql://user:pass@localhost:5432/test',
        // Porta sem Redis: as filas tentam reconectar em segundo plano, sem impedir a subida.
        redisUrl: 'redis://127.0.0.1:1',
        relay: { intervalMs: 60_000 },
        // O nodemailer só conecta ao enviar: a porta não precisa ter servidor.
        email: { from: 'ingressos@ticketflow.local', smtp: { host: '127.0.0.1', port: 1 } },
        heartbeat: { file, intervalMs: 60_000 },
      }),
      { logger: false },
    );
    const heartbeat = app.get(HeartbeatService);

    expect(heartbeat.isActive).toBe(true);
    // O consumidor só processa se o @nestjs/bullmq criou o worker dele.
    const { worker } = app.get(SendTicketEmailProcessor);
    expect(worker.name).toBe('send-ticket-email');

    // Sem Redis, o close gracioso do worker do BullMQ não termina (ADR 0013): fecha à força
    // aqui, e o close do app reaproveita o fechamento já feito.
    await worker.close(true);
    expect(await isHeartbeatFresh(file)).toBe(true);

    await app.close();

    expect(heartbeat.isActive).toBe(false);
    expect(await isHeartbeatFresh(file)).toBe(false);
  });
});
