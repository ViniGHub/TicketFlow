import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

/**
 * Mantém o processo do worker vivo enquanto não há filas registradas.
 * Um application context do Nest não abre nenhum handle; sem isso o Node encerraria logo
 * após o boot. Remover na etapa 5.1, quando as conexões do BullMQ cumprem esse papel.
 */
@Injectable()
export class KeepAliveService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  get isActive(): boolean {
    return this.timer !== undefined;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => undefined, 60_000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
