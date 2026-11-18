import { type EventSummaryResponse, type TicketTypeResponse } from '@ticketflow/contracts';

import { formatCents, formatEventDateShort } from '../format';

// O que as telas do catálogo mostram, já formatado (ROADMAP, etapa 6.2). O servidor monta isto
// e passa aos componentes do navegador: o texto da data é o mesmo na renderização e na
// hidratação.

export interface EventCardView {
  id: string;
  title: string;
  venue: string;
  dateLabel: string;
}

export function toEventCard(event: EventSummaryResponse): EventCardView {
  return {
    id: event.id,
    title: event.title,
    venue: event.venue,
    dateLabel: formatEventDateShort(event.startsAt, event.timezone),
  };
}

export type LotState =
  | { type: 'on-sale'; maxQuantity: number }
  | { type: 'sold-out' }
  | { type: 'not-started'; label: string }
  | { type: 'ended' };

export interface LotView {
  id: string;
  name: string;
  priceCents: number;
  priceLabel: string;
  state: LotState;
}

/**
 * Se o lote vende agora, e até quantos por pedido. A API confere tudo de novo na compra: isto
 * só decide o que a tela oferece.
 */
export function lotSaleState(lot: TicketTypeResponse, now: Date, timeZone: string): LotState {
  if (now < new Date(lot.salesStart)) {
    return {
      type: 'not-started',
      label: `Abre ${formatEventDateShort(lot.salesStart, timeZone)}`,
    };
  }
  if (now >= new Date(lot.salesEnd)) {
    return { type: 'ended' };
  }
  if (lot.available <= 0) {
    return { type: 'sold-out' };
  }
  return { type: 'on-sale', maxQuantity: Math.min(lot.maxPerOrder, lot.available) };
}

export function toLotView(lot: TicketTypeResponse, now: Date, timeZone: string): LotView {
  return {
    id: lot.id,
    name: lot.name,
    priceCents: lot.priceCents,
    priceLabel: lot.priceCents === 0 ? 'Grátis' : formatCents(lot.priceCents),
    state: lotSaleState(lot, now, timeZone),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id malformado nem chega à API: é página inexistente. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
