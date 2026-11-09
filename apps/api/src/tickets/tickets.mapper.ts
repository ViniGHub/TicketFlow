import { type MyTicketResponse } from '@ticketflow/contracts';
import { type Prisma } from '@ticketflow/db';
import { ticketStatusOf } from '@ticketflow/domain';

/** O ingresso com o lote e o evento, como o comprador vê. */
export const withTicketDetails = {
  ticketType: { select: { id: true, name: true } },
  event: { select: { id: true, title: true, venue: true, timezone: true, startsAt: true } },
} as const satisfies Prisma.TicketInclude;

export type TicketWithDetails = Prisma.TicketGetPayload<{ include: typeof withTicketDetails }>;

export function toMyTicketResponse(ticket: TicketWithDetails): MyTicketResponse {
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    qrToken: ticket.qrToken,
    status: ticketStatusOf(ticket),
    checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
    voidedAt: ticket.voidedAt?.toISOString() ?? null,
    ticketType: ticket.ticketType,
    event: { ...ticket.event, startsAt: ticket.event.startsAt.toISOString() },
  };
}
