import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaClient } from '@ticketflow/db';

import { JOB_PUBLISHER, type JobPublisher } from '../queues/job-publisher';

import { OutboxRelay, RELAY_BATCH_SIZE } from './outbox-relay';
import { OutboxRelayService, RELAY_INTERVAL, RELAY_INTERVAL_MS } from './outbox-relay.service';
import { PrismaOutboxStore } from './outbox-store';

export interface OutboxModuleOptions {
  intervalMs?: number;
  batchSize?: number;
}

/** Relay da outbox: publica as linhas pendentes nas filas do BullMQ (ADR 0012). */
@Module({})
export class OutboxModule {
  static forRoot({
    intervalMs = RELAY_INTERVAL_MS,
    batchSize = RELAY_BATCH_SIZE,
  }: OutboxModuleOptions = {}): DynamicModule {
    return {
      module: OutboxModule,
      providers: [
        { provide: RELAY_INTERVAL, useValue: intervalMs },
        {
          provide: OutboxRelay,
          inject: [PrismaClient, JOB_PUBLISHER],
          useFactory: (prisma: PrismaClient, publisher: JobPublisher) =>
            new OutboxRelay(new PrismaOutboxStore(prisma), publisher, batchSize),
        },
        OutboxRelayService,
      ],
    };
  }
}
