import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { KeepAliveService } from './keep-alive.service';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('sobe como application context e encerra liberando o processo', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    const keepAlive = app.get(KeepAliveService);

    expect(keepAlive.isActive).toBe(true);

    await app.close();

    expect(keepAlive.isActive).toBe(false);
  });
});
