import { z } from 'zod';

import { myEventsQuerySchema, pageSchema } from './events.js';
import { orderStatusSchema } from './orders.js';

// Ingressos, check-in e vendas (ROADMAP, etapa 4.4; ARCHITECTURE.md, seção 9).

/** `VALID` até o check-in (`USED`); `VOIDED` quando o pedido foi reembolsado. */
export const TICKET_STATUSES = ['VALID', 'USED', 'VOIDED'] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatusValue = z.infer<typeof ticketStatusSchema>;

/** `qr_token`: 32 bytes aleatórios em base64url, sem padding (seção 10). */
export const qrTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'QR code em formato inválido.')
  .meta({ example: 'bUHxdPPHbw2IBWVB1hgF_zY5KMs2HpWEq_QA7GHi0iw' });

/** `GET /me/tickets`: a mesma paginação por cursor de `GET /me/events`. */
export const myTicketsQuerySchema = myEventsQuerySchema;
export type MyTicketsQuery = z.infer<typeof myTicketsQuerySchema>;

const ticketTypeRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const myTicketResponseSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  /** O que o comprador apresenta na entrada, como QR code. */
  qrToken: z.string(),
  status: ticketStatusSchema,
  checkedInAt: z.iso.datetime().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  ticketType: ticketTypeRefSchema,
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    venue: z.string(),
    timezone: z.string(),
    startsAt: z.iso.datetime(),
  }),
});
export type MyTicketResponse = z.infer<typeof myTicketResponseSchema>;
export const myTicketPageSchema = pageSchema(myTicketResponseSchema);

/** `POST /events/:id/check-in`. */
export const checkInRequestSchema = z.object({ qrToken: qrTokenSchema });
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

/** Check-in aceito. As recusas saem como erro (404, 409, 422). */
export const checkInResponseSchema = z.object({
  ticketId: z.uuid(),
  ticketType: ticketTypeRefSchema,
  checkedInAt: z.iso.datetime(),
});
export type CheckInResponse = z.infer<typeof checkInResponseSchema>;

const salesCountsSchema = z.object({
  /** Ingressos de pedidos pagos. */
  sold: z.int(),
  /** Ingressos de pedidos ainda à espera do pagamento (`PENDING`, `PROCESSING`). */
  reserved: z.int(),
  /** Receita dos pedidos pagos, em centavos. Reembolso sai da conta. */
  revenueCents: z.int(),
});

export const ticketTypeSalesSchema = salesCountsSchema.extend({
  ticketTypeId: z.uuid(),
  name: z.string(),
  priceCents: z.int(),
  total: z.int(),
  available: z.int(),
});

/** `GET /events/:id/sales`: vendas por lote e pedidos por status (todos, mesmo com zero). */
export const eventSalesResponseSchema = z.object({
  eventId: z.uuid(),
  currency: z.literal('BRL'),
  ticketTypes: z.array(ticketTypeSalesSchema),
  totals: salesCountsSchema,
  ordersByStatus: z.record(orderStatusSchema, z.int()),
});
export type EventSalesResponse = z.infer<typeof eventSalesResponseSchema>;
