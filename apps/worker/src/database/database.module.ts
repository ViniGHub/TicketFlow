import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@ticketflow/db';

export interface DatabaseModuleOptions {
  url: string;
}

/**
 * Fecha o pool de conexões quando a aplicação encerra (SIGTERM ou `app.close()`). Na última
 * fase do shutdown: o relay da outbox termina o lote em andamento antes, em
 * `beforeApplicationShutdown`.
 */
@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Disponibiliza o `PrismaClient` de packages/db para injeção (`@Inject(PrismaClient)`).
 * O client só abre conexão na primeira consulta, então o worker sobe mesmo com o banco fora.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: PrismaClient, useFactory: () => createPrismaClient(options.url) },
        PrismaLifecycle,
      ],
      exports: [PrismaClient],
    };
  }
}
