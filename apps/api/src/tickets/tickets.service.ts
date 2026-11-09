import { Inject, Injectable } from '@nestjs/common';
import {
  type CheckInResponse,
  type MyTicketResponse,
  type MyTicketsQuery,
  type Page,
} from '@ticketflow/contracts';
import { PrismaClient } from '@ticketflow/db';
import { checkInRejection } from '@ticketflow/domain';
import { z } from 'zod';

import { decodeCursor, encodeCursor, toPage } from '../common/pagination';
import { EventNotFoundError } from '../events/events.errors';

import { toMyTicketResponse, withTicketDetails } from './tickets.mapper';

/** Chave da lista de ingressos: o id (UUID v7 ordena pela emissão). */
const idCursorSchema = z.object({ id: z.uuid() });

/** Ingressos do comprador e check-in na entrada (ROADMAP, etapa 4.4; ADR 0011). */
@Injectable()
export class TicketsService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /** Ingressos dos pedidos do comprador, em qualquer status, os emitidos por último primeiro. */
  async listMine(userId: string, query: MyTicketsQuery): Promise<Page<MyTicketResponse>> {
    const after = query.cursor ? decodeCursor(query.cursor, idCursorSchema) : undefined;
    const rows = await this.prisma.ticket.findMany({
      where: { order: { userId }, ...(after && { id: { lt: after.id } }) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: withTicketDetails,
    });
    return toPage(rows, query.limit, toMyTicketResponse, (last) => encodeCursor({ id: last.id }));
  }

  /**
   * Marca a entrada do ingresso, uma vez só (ARCHITECTURE.md, seção 9). O UPDATE só acerta o
   * ingresso válido deste evento e decide sozinho entre check-ins simultâneos, sem trava nem
   * transação. Quando ele não muda nada, o ingresso é lido para dizer o motivo.
   */
  async checkIn(
    organizerId: string,
    eventId: string,
    qrToken: string,
    now = new Date(),
  ): Promise<CheckInResponse> {
    await this.assertOwnsEvent(organizerId, eventId);

    const { count } = await this.prisma.ticket.updateMany({
      where: { qrToken, eventId, checkedInAt: null, voidedAt: null },
      data: { checkedInAt: now },
    });
    if (count === 0) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { qrToken },
        select: { eventId: true, checkedInAt: true, voidedAt: true },
      });
      throw checkInRejection(ticket, eventId);
    }

    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { qrToken },
      select: { id: true, ticketType: { select: { id: true, name: true } } },
    });
    return { ticketId: ticket.id, ticketType: ticket.ticketType, checkedInAt: now.toISOString() };
  }

  /** Evento de outro organizador responde 404, como se não existisse. */
  private async assertOwnsEvent(organizerId: string, eventId: string): Promise<void> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId },
      select: { id: true },
    });
    if (!event) {
      throw new EventNotFoundError();
    }
  }
}
