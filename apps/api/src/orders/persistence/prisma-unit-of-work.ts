import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@ticketflow/db';
import { type TransactionalRepositories, type UnitOfWork } from '@ticketflow/domain';

import {
  PrismaCatalogRepository,
  PrismaInventoryRepository,
  PrismaOrderRepository,
  PrismaOutboxRepository,
  PrismaStripeEventRepository,
  PrismaTicketRepository,
} from './prisma-repositories';

/**
 * Limites da transação. Os padrões do Prisma (2 s para conseguir conexão, 5 s de duração),
 * com o pool de 10 conexões do `pg`, estouram quando dezenas de compras disputam o mesmo
 * lote: cada uma espera a anterior liberar a linha. Estourar vira 500 em vez de 409.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Unidade de trabalho do domínio sobre `prisma.$transaction` (ADR 0005). */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) =>
        work({
          catalog: new PrismaCatalogRepository(tx),
          inventory: new PrismaInventoryRepository(tx),
          orders: new PrismaOrderRepository(tx),
          outbox: new PrismaOutboxRepository(tx),
          tickets: new PrismaTicketRepository(tx),
          stripeEvents: new PrismaStripeEventRepository(tx),
        }),
      TRANSACTION_OPTIONS,
    );
  }
}
