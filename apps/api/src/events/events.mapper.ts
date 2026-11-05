import {
  type EventResponse,
  type EventSummaryResponse,
  type TicketTypeResponse,
} from '@ticketflow/contracts';
import { type Event, type Prisma, type TicketType } from '@ticketflow/db';

/** Lotes junto com o evento, na ordem em que foram criados (UUID v7). */
export const withTicketTypes = {
  ticketTypes: { orderBy: { id: 'asc' } },
} as const satisfies Prisma.EventInclude;

export type EventWithTicketTypes = Event & { ticketTypes: TicketType[] };

export function toTicketTypeResponse(ticketType: TicketType): TicketTypeResponse {
  return {
    id: ticketType.id,
    name: ticketType.name,
    priceCents: ticketType.priceCents,
    total: ticketType.total,
    available: ticketType.available,
    salesStart: ticketType.salesStart.toISOString(),
    salesEnd: ticketType.salesEnd.toISOString(),
    maxPerOrder: ticketType.maxPerOrder,
  };
}

export function toEventSummaryResponse(event: Event): EventSummaryResponse {
  return {
    id: event.id,
    title: event.title,
    venue: event.venue,
    timezone: event.timezone,
    startsAt: event.startsAt.toISOString(),
    status: event.status,
  };
}

export function toEventResponse(event: EventWithTicketTypes): EventResponse {
  return {
    ...toEventSummaryResponse(event),
    description: event.description,
    ticketTypes: event.ticketTypes.map(toTicketTypeResponse),
  };
}
