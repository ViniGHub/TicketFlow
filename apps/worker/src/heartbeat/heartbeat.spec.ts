import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HEARTBEAT_MAX_AGE_MS, isHeartbeatFresh } from './heartbeat';

describe('isHeartbeatFresh', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'heartbeat-'));
    file = join(dir, 'worker.heartbeat');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('é falso quando o arquivo não existe', async () => {
    expect(await isHeartbeatFresh(file)).toBe(false);
  });

  it('é verdadeiro para um arquivo tocado agora', async () => {
    await writeFile(file, 'x');

    expect(await isHeartbeatFresh(file)).toBe(true);
  });

  it('é falso quando a última batida passou da idade máxima', async () => {
    await writeFile(file, 'x');
    const old = new Date(Date.now() - HEARTBEAT_MAX_AGE_MS - 5_000);
    await utimes(file, old, old);

    expect(await isHeartbeatFresh(file)).toBe(false);
  });
});
