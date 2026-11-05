import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateTicketTypeRequest,
  type TicketTypeResponse,
  type UpdateTicketTypeRequest,
} from '@ticketflow/contracts';
import { PrismaClient } from '@ticketflow/db';
import { assertEventEditable, assertSalesWindow, resizeStock } from '@ticketflow/domain';

import { lockOwnedEvent, lockTicketType } from './catalog-locks';
import { toTicketTypeResponse } from './events.mapper';

/** Lotes de um evento. Só o organizador dono gerencia (ROADMAP, etapa 2.1). */
@Injectable()
export class TicketTypesService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async create(
    organizerId: string,
    eventId: string,
    input: CreateTicketTypeRequest,
  ): Promise<TicketTypeResponse> {
    const ticketType = await this.prisma.$transaction(async (tx) => {
      const event = await lockOwnedEvent(tx, eventId, organizerId);
      assertEventEditable(event.status);
      assertSalesWindow(input, event.startsAt);
      return tx.ticketType.create({ data: { ...input, eventId, available: input.total } });
    });
    return toTicketTypeResponse(ticketType);
  }

  /**
   * Edição parcial. A janela de vendas é validada já combinada com os valores atuais, e o
   * novo total preserva o que foi vendido ou reservado (`resizeStock`).
   */
  async update(
    organizerId: string,
    eventId: string,
    ticketTypeId: string,
    input: UpdateTicketTypeRequest,
  ): Promise<TicketTypeResponse> {
    const ticketType = await this.prisma.$transaction(async (tx) => {
      const event = await lockOwnedEvent(tx, eventId, organizerId);
      assertEventEditable(event.status);
      const current = await lockTicketType(tx, eventId, ticketTypeId);
      if (input.salesStart || input.salesEnd) {
        assertSalesWindow(
          {
            salesStart: input.salesStart ?? current.salesStart,
            salesEnd: input.salesEnd ?? current.salesEnd,
          },
          event.startsAt,
        );
      }
      const stock = input.total === undefined ? {} : resizeStock(current, input.total);
      return tx.ticketType.update({ where: { id: ticketTypeId }, data: { ...input, ...stock } });
    });
    return toTicketTypeResponse(ticketType);
  }
}
