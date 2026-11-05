import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateEventRequest,
  type EventResponse,
  type UpdateEventRequest,
} from '@ticketflow/contracts';
import { PrismaClient } from '@ticketflow/db';
import {
  assertEventDeletable,
  assertEventEditable,
  assertEventSchedule,
  assertStartsInFuture,
  decidePublish,
} from '@ticketflow/domain';

import { lockOwnedEvent } from './catalog-locks';
import { toEventResponse, withTicketTypes } from './events.mapper';

/** Eventos do catálogo. Escritas: só o organizador dono (ROADMAP, etapa 2.1). */
@Injectable()
export class EventsService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /** Todo evento nasce em rascunho; só aparece no catálogo depois de publicado. */
  async create(
    organizerId: string,
    input: CreateEventRequest,
    now = new Date(),
  ): Promise<EventResponse> {
    assertStartsInFuture(input.startsAt, now);
    const event = await this.prisma.event.create({
      data: { ...input, organizerId },
      include: withTicketTypes,
    });
    return toEventResponse(event);
  }

  async update(
    organizerId: string,
    eventId: string,
    input: UpdateEventRequest,
    now = new Date(),
  ): Promise<EventResponse> {
    const event = await this.prisma.$transaction(async (tx) => {
      const current = await lockOwnedEvent(tx, eventId, organizerId);
      assertEventEditable(current.status);
      if (input.startsAt) {
        const salesWindows = await tx.ticketType.findMany({
          where: { eventId },
          select: { salesStart: true, salesEnd: true },
        });
        assertEventSchedule(input.startsAt, salesWindows, now);
      }
      return tx.event.update({ where: { id: eventId }, data: input, include: withTicketTypes });
    });
    return toEventResponse(event);
  }

  /** Idempotente: publicar um evento já publicado devolve o evento sem mudar nada. */
  async publish(organizerId: string, eventId: string, now = new Date()): Promise<EventResponse> {
    const event = await this.prisma.$transaction(async (tx) => {
      const current = await lockOwnedEvent(tx, eventId, organizerId);
      const ticketTypeCount = await tx.ticketType.count({ where: { eventId } });
      const decision = decidePublish({ ...current, ticketTypeCount }, now);
      if (decision === 'already-published') {
        return tx.event.findUniqueOrThrow({ where: { id: eventId }, include: withTicketTypes });
      }
      return tx.event.update({
        where: { id: eventId },
        data: { status: 'PUBLISHED' },
        include: withTicketTypes,
      });
    });
    return toEventResponse(event);
  }

  /** Só rascunho: nunca foi publicado, então não tem pedidos nem ingressos. */
  async remove(organizerId: string, eventId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await lockOwnedEvent(tx, eventId, organizerId);
      assertEventDeletable(current.status);
      await tx.ticketType.deleteMany({ where: { eventId } });
      await tx.event.delete({ where: { id: eventId } });
    });
  }
}
