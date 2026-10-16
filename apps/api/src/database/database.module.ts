import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@ticketflow/db';

export interface DatabaseModuleOptions {
  url: string;
}

/** Fecha o pool de conexões quando a aplicação encerra (SIGTERM ou `app.close()`). */
@Injectable()
class PrismaLifecycle implements OnModuleDestroy {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Disponibiliza o `PrismaClient` de packages/db para injeção (`@Inject(PrismaClient)`).
 * O client só abre conexão na primeira consulta, então a API sobe mesmo com o banco fora;
 * quem acusa isso é o `/health/ready` (etapa 1.4).
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
