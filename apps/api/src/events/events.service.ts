import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateEventRequest,
  type EventResponse,
  type EventSummaryResponse,
  type ListEventsQuery,
  type MyEventsQuery,
  type Page,
  type UpdateEventRequest,
} from '@ticketflow/contracts';
import { type Prisma, PrismaClient } from '@ticketflow/db';
import {
  assertEventDeletable,
  assertEventEditable,
  assertEventSchedule,
  assertStartsInFuture,
  decidePublish,
  EventNotFoundError,
} from '@ticketflow/domain';
import { z } from 'zod';

import { decodeCursor, encodeCursor, toPage } from '../common/pagination';

import { lockOwnedEvent } from './catalog-locks';
import { toEventResponse, toEventSummaryResponse, withTicketTypes } from './events.mapper';

/** Chave do catálogo público: ordem por data do evento, com o id desempatando. */
const publicCursorSchema = z.object({
  startsAt: z.iso.datetime().transform((value) => new Date(value)),
  id: z.uuid(),
});

/** Chave da lista do organizador: o id (UUID v7 ordena pela criação). */
const idCursorSchema = z.object({ id: z.uuid() });

/** Eventos do catálogo. Escritas: só o organizador dono (ROADMAP, etapa 2.1). */
@Injectable()
export class EventsService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * Catálogo público: só eventos publicados, em `[from, to)` (sem `from`, a partir de agora),
   * em ordem de data. Usa o índice `events(status, starts_at)`.
   */
  async listPublished(
    query: ListEventsQuery,
    now = new Date(),
  ): Promise<Page<EventSummaryResponse>> {
    const after = query.cursor ? decodeCursor(query.cursor, publicCursorSchema) : undefined;
    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      startsAt: { gte: query.from ?? now, ...(query.to && { lt: query.to }) },
    };
    if (after) {
      where.OR = [
        { startsAt: { gt: after.startsAt } },
        { startsAt: after.startsAt, id: { gt: after.id } },
      ];
    }
    const rows = await this.prisma.event.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, toEventSummaryResponse, (last) =>
      encodeCursor({ startsAt: last.startsAt.toISOString(), id: last.id }),
    );
  }

  /** Detalhe público. Rascunho ou cancelado responde 404, como evento inexistente. */
  async getPublished(eventId: string): Promise<EventResponse> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'PUBLISHED' },
      include: withTicketTypes,
    });
    if (!event) {
      throw new EventNotFoundError();
    }
    return toEventResponse(event);
  }

  /** Eventos do organizador em qualquer status, com os lotes; os criados por último primeiro. */
  async listMine(organizerId: string, query: MyEventsQuery): Promise<Page<EventResponse>> {
    const after = query.cursor ? decodeCursor(query.cursor, idCursorSchema) : undefined;
    const rows = await this.prisma.event.findMany({
      where: { organizerId, ...(after && { id: { lt: after.id } }) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: withTicketTypes,
    });
    return toPage(rows, query.limit, toEventResponse, (last) => encodeCursor({ id: last.id }));
  }

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
