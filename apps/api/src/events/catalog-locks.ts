import { type Prisma } from '@ticketflow/db';
import {
  type EventStatus,
  type SalesWindow,
  type Stock,
  TicketTypeNotFoundError,
} from '@ticketflow/domain';

import { EventNotFoundError } from './events.errors';

// Toda escrita no catálogo começa travando o evento (FOR UPDATE) dentro da transação. Sem a
// trava, mover a data do evento e mudar o fim das vendas de um lote ao mesmo tempo passariam
// nas duas validações e deixariam o lote vendendo depois do início do evento. Ordem das
// travas: evento, depois lote. A compra trava o evento em modo compartilhado (FOR SHARE) e
// depois o lote, então espera estas escritas e é esperada por elas (ADR 0006).

export interface LockedEvent {
  id: string;
  status: EventStatus;
  startsAt: Date;
}

export interface LockedTicketType extends Stock, SalesWindow {
  id: string;
}

interface LockedEventRow {
  id: string;
  status: EventStatus;
  starts_at: Date;
}

interface LockedTicketTypeRow {
  id: string;
  total: number;
  available: number;
  sales_start: Date;
  sales_end: Date;
}

/** Trava o evento do organizador. Inexistente ou de outro dono: 404. */
export async function lockOwnedEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
  organizerId: string,
): Promise<LockedEvent> {
  const [event] = await tx.$queryRaw<LockedEventRow[]>`
    SELECT id, status::text AS status, starts_at
    FROM events
    WHERE id = ${eventId}::uuid AND organizer_id = ${organizerId}::uuid
    FOR UPDATE`;
  if (!event) {
    throw new EventNotFoundError();
  }
  return { id: event.id, status: event.status, startsAt: event.starts_at };
}

/**
 * Trava o lote para ler `available` sem corrida com a reserva de estoque: o decremento
 * atômico de um pedido espera esta transação terminar.
 */
export async function lockTicketType(
  tx: Prisma.TransactionClient,
  eventId: string,
  ticketTypeId: string,
): Promise<LockedTicketType> {
  const [ticketType] = await tx.$queryRaw<LockedTicketTypeRow[]>`
    SELECT id, total, available, sales_start, sales_end
    FROM ticket_types
    WHERE id = ${ticketTypeId}::uuid AND event_id = ${eventId}::uuid
    FOR UPDATE`;
  if (!ticketType) {
    throw new TicketTypeNotFoundError();
  }
  return {
    id: ticketType.id,
    total: ticketType.total,
    available: ticketType.available,
    salesStart: ticketType.sales_start,
    salesEnd: ticketType.sales_end,
  };
}
