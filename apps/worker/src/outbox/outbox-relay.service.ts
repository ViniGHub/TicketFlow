import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { OutboxRelay } from './outbox-relay';

export const RELAY_INTERVAL_MS = 1_000;
export const RELAY_INTERVAL = Symbol('RELAY_INTERVAL');

/**
 * Roda o relay em loop: um lote por ciclo, a cada `intervalMs`, ou na hora quando o lote veio
 * cheio. Erro num ciclo vai para o log e o loop segue. No shutdown, para de agendar e espera o
 * lote em andamento, antes de o Prisma e as filas fecharem (`onApplicationShutdown`).
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
    @Inject(RELAY_INTERVAL) private readonly intervalMs: number,
  ) {}

  get isRunning(): boolean {
    return !this.stopped;
  }

  onApplicationBootstrap(): void {
    this.stopped = false;
    this.schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.current;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.current = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let next = this.intervalMs;
    try {
      const result = await this.relay.relayBatch();
      if (result.full && result.failed === 0) {
        next = 0;
      }
    } catch (error) {
      this.logger.error({
        message: 'Ciclo do relay da outbox falhou',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.schedule(next);
  }
}
