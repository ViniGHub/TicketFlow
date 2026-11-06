import { z } from 'zod';

// Catálogo: eventos e lotes (ARCHITECTURE.md, seções 3 e 9). Aqui fica a forma da entrada
// (400); as regras que dependem de outros dados (janela de vendas x data do evento, total x
// vendido) ficam em packages/domain.

/** Limites superiores: evitam abuso e estouro do `int4` do Postgres. */
export const CATALOG_LIMITS = {
  /** R$ 999.999,99: o maior total de pedido que o Stripe aceita (ADR 0008). */
  maxPriceCents: 99_999_999,
  maxTicketsPerType: 100_000,
  maxPerOrder: 100,
  defaultPageSize: 20,
  maxPageSize: 50,
} as const;

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);

/**
 * Nome IANA do fuso, normalizado pelo Intl (ex.: `america/sao_paulo` → `America/Sao_Paulo`).
 * Offsets fixos (`-03:00`) são recusados: não acompanham horário de verão nem mudanças de
 * regra do fuso.
 */
export function normalizeTimeZone(value: string): string | undefined {
  if (/^[+-]/.test(value)) {
    return undefined;
  }
  try {
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
    return /^[+-]/.test(zone) ? undefined : zone;
  } catch {
    return undefined;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, ctx) => {
    const zone = normalizeTimeZone(value);
    if (!zone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Fuso horário inválido. Use um nome IANA, como America/Sao_Paulo.',
      });
      return z.NEVER;
    }
    return zone;
  })
  .meta({ example: 'America/Sao_Paulo' });

/** Data e hora ISO 8601 com fuso explícito (`Z` ou `-03:00`); sem fuso, a hora é ambígua. */
export const dateTimeInputSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .meta({ example: '2026-12-10T20:00:00-03:00' });

/** Datas nas respostas: sempre em UTC; o front exibe no `timezone` do evento. */
const dateTimeOutputSchema = z.iso.datetime();

function atLeastOneField<Schema extends z.ZodObject>(schema: Schema): Schema {
  return schema.refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Informe ao menos um campo.',
  );
}

const eventFields = {
  title: z.string().trim().min(1).max(120).meta({ example: 'Jazz no Parque' }),
  description: z.string().trim().max(5000).meta({ example: 'Noite de jazz ao ar livre.' }),
  venue: z.string().trim().min(1).max(200).meta({ example: 'Parque Ibirapuera, São Paulo' }),
  timezone: timeZoneSchema,
  startsAt: dateTimeInputSchema,
};

export const createEventRequestSchema = z.object({
  ...eventFields,
  description: eventFields.description.default(''),
});
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const updateEventRequestSchema = atLeastOneField(z.object(eventFields).partial());
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

const ticketTypeFields = {
  name: z.string().trim().min(1).max(80).meta({ example: 'Pista' }),
  priceCents: z
    .int()
    .min(0)
    .max(CATALOG_LIMITS.maxPriceCents)
    .meta({ description: 'Preço em centavos de BRL.', example: 8000 }),
  total: z.int().min(1).max(CATALOG_LIMITS.maxTicketsPerType).meta({ example: 100 }),
  salesStart: dateTimeInputSchema,
  salesEnd: dateTimeInputSchema,
  maxPerOrder: z.int().min(1).max(CATALOG_LIMITS.maxPerOrder).meta({ example: 4 }),
};

export const createTicketTypeRequestSchema = z.object(ticketTypeFields);
export type CreateTicketTypeRequest = z.infer<typeof createTicketTypeRequestSchema>;

export const updateTicketTypeRequestSchema = atLeastOneField(z.object(ticketTypeFields).partial());
export type UpdateTicketTypeRequest = z.infer<typeof updateTicketTypeRequestSchema>;

const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .optional()
  .meta({ description: 'Valor de `nextCursor` da página anterior.' });

const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(CATALOG_LIMITS.maxPageSize)
  .default(CATALOG_LIMITS.defaultPageSize);

/** `GET /events`: intervalo `[from, to)` sobre `startsAt`. Sem `from`, só eventos futuros. */
export const listEventsQuerySchema = z
  .object({
    from: dateTimeInputSchema.optional(),
    to: dateTimeInputSchema.optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  })
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    message: '`from` precisa ser antes de `to`.',
    path: ['to'],
  });
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/** `GET /me/events`: eventos do organizador em qualquer status, os criados por último primeiro. */
export const myEventsQuerySchema = z.object({ cursor: cursorSchema, limit: limitSchema });
export type MyEventsQuery = z.infer<typeof myEventsQuerySchema>;

export const ticketTypeResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceCents: z.int(),
  total: z.int(),
  available: z.int(),
  salesStart: dateTimeOutputSchema,
  salesEnd: dateTimeOutputSchema,
  maxPerOrder: z.int(),
});
export type TicketTypeResponse = z.infer<typeof ticketTypeResponseSchema>;

export const eventSummaryResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  venue: z.string(),
  timezone: z.string(),
  startsAt: dateTimeOutputSchema,
  status: eventStatusSchema,
});
export type EventSummaryResponse = z.infer<typeof eventSummaryResponseSchema>;

export const eventResponseSchema = eventSummaryResponseSchema.extend({
  description: z.string(),
  ticketTypes: z.array(ticketTypeResponseSchema),
});
export type EventResponse = z.infer<typeof eventResponseSchema>;

/** Página com paginação por cursor: `nextCursor` nulo indica a última página. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}

export const eventSummaryPageSchema = pageSchema(eventSummaryResponseSchema);
export const eventPageSchema = pageSchema(eventResponseSchema);
