import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@ticketflow/db';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseModule } from './database.module';

describe('DatabaseModule', () => {
  it('fornece o PrismaClient sem conectar e o desconecta ao encerrar', async () => {
    const app = await NestFactory.createApplicationContext(
      DatabaseModule.forRoot({ url: 'postgresql://user:pass@localhost:5432/ticketflow' }),
      { logger: false },
    );
    const prisma = app.get(PrismaClient);
    const disconnect = vi.spyOn(prisma, '$disconnect');

    // O construtor do Prisma 7 devolve outro objeto: `instanceof PrismaClient` é falso.
    expect(typeof prisma.$queryRaw).toBe('function');

    await app.close();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
