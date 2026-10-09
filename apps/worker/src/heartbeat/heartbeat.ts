import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Intervalo entre batidas do heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Idade máxima aceita pelo healthcheck: três batidas perdidas. */
export const HEARTBEAT_MAX_AGE_MS = 3 * HEARTBEAT_INTERVAL_MS;

export function defaultHeartbeatFile(): string {
  return join(tmpdir(), 'ticketflow-worker.heartbeat');
}

/** O heartbeat é considerado vivo se o arquivo foi tocado há no máximo `maxAgeMs`. */
export async function isHeartbeatFresh(
  file: string,
  maxAgeMs: number = HEARTBEAT_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(file);
    return now - mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}
