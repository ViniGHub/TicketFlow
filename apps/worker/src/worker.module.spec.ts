import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isHeartbeatFresh } from './heartbeat/heartbeat';
import { HeartbeatService } from './heartbeat/heartbeat.service';
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
      WorkerModule.register({ heartbeat: { file, intervalMs: 60_000 } }),
      { logger: false },
    );
    const heartbeat = app.get(HeartbeatService);

    expect(heartbeat.isActive).toBe(true);
    expect(await isHeartbeatFresh(file)).toBe(true);

    await app.close();

    expect(heartbeat.isActive).toBe(false);
    expect(await isHeartbeatFresh(file)).toBe(false);
  });
});
