import {
  type CreateEventRequest,
  createEventRequestSchema,
  type EVENT_STATUSES,
} from '@ticketflow/contracts';

import { type BadgeTone } from '../../components/ui/badge';
import { type FieldErrors, validate } from '../forms/validate';
import { DEFAULT_TIME_ZONE, isoToZonedLocal, zonedLocalToIso } from '../forms/zoned-time';

// Eventos do organizador (ROADMAP, etapa 6.3; ADR 0018).

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS: Readonly<Record<EventStatus, { label: string; tone: BadgeTone }>> = {
  DRAFT: { label: 'Rascunho', tone: 'muted' },
  PUBLISHED: { label: 'Publicado', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
};

/** Os campos, na ordem da tela: o foco vai para o primeiro com erro. */
export const EVENT_FIELDS = ['title', 'description', 'venue', 'timezone', 'startsAt'] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

/** O formulário como o organizador preenche: a data no `datetime-local`, no fuso escolhido. */
export type EventFormValues = Record<EventField, string>;

export const EVENT_MESSAGES: Record<EventField, string> = {
  title: 'Informe o título, com até 120 caracteres.',
  description: 'A descrição pode ter até 5.000 caracteres.',
  venue: 'Informe o local, com até 200 caracteres.',
  timezone: 'Escolha o fuso do evento.',
  startsAt: 'Informe a data e a hora do evento.',
};

export const EMPTY_EVENT: EventFormValues = {
  title: '',
  description: '',
  venue: '',
  timezone: DEFAULT_TIME_ZONE,
  startsAt: '',
};

/** O evento salvo de volta no formulário, para editar: a data no fuso do próprio evento. */
export function eventFormValuesOf(event: {
  title: string;
  description: string;
  venue: string;
  timezone: string;
  startsAt: string;
}): EventFormValues {
  return {
    title: event.title,
    description: event.description,
    venue: event.venue,
    timezone: event.timezone,
    startsAt: isoToZonedLocal(event.startsAt, event.timezone),
  };
}

export function eventFormValuesFrom(form: FormData): EventFormValues {
  const text = (field: EventField) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  };
  return {
    title: text('title'),
    description: text('description'),
    venue: text('venue'),
    timezone: text('timezone'),
    startsAt: text('startsAt'),
  };
}

/** Corpo de `POST /events` e `PATCH /events/:id`: o schema da API, com a data em ISO. */
export type EventBody = Omit<CreateEventRequest, 'startsAt'> & { startsAt: string };

export function eventBodyFrom(
  values: EventFormValues,
): { ok: true; body: EventBody } | { ok: false; errors: FieldErrors<EventField> } {
  const startsAt = zonedLocalToIso(values.startsAt, values.timezone) ?? '';
  const result = validate(createEventRequestSchema, { ...values, startsAt }, EVENT_MESSAGES);
  if (!result.ok) {
    return result;
  }
  return { ok: true, body: { ...result.data, startsAt: result.data.startsAt.toISOString() } };
}
