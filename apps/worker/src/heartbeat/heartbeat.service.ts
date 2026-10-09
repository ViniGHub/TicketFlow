import { rm, writeFile } from 'node:fs/promises';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

export const HEARTBEAT_OPTIONS = Symbol('HEARTBEAT_OPTIONS');

export interface HeartbeatOptions {
  file: string;
  intervalMs: number;
}

/**
 * Grava periodicamente um arquivo que o healthcheck do container verifica
 * (`dist/healthcheck.js`). Se o event loop travar, as batidas param e o container
 * fica unhealthy.
 *
 * O timer também mantém o processo vivo: um application context do Nest não abre nenhum
 * handle sozinho. A partir da etapa 5.1 as conexões do BullMQ fazem isso também.
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(@Inject(HEARTBEAT_OPTIONS) private readonly options: HeartbeatOptions) {}

  get isActive(): boolean {
    return this.timer !== undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), this.options.intervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await rm(this.options.file, { force: true });
  }

  private async beat(): Promise<void> {
    try {
      await writeFile(this.options.file, new Date().toISOString());
    } catch (error) {
      this.logger.error(`Falha ao gravar o heartbeat em ${this.options.file}`, error);
    }
  }
}
