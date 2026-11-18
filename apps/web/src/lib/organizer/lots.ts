import {
  CATALOG_LIMITS,
  type CreateTicketTypeRequest,
  createTicketTypeRequestSchema,
} from '@ticketflow/contracts';

import { formatCents, formatEventDateShort } from '../format';
import { centsToReaisInput, parseReais } from '../forms/money';
import { changedFields } from '../forms/patch';
import { type FieldErrors, validate } from '../forms/validate';
import { isoToZonedLocal, zonedLocalToIso } from '../forms/zoned-time';

// Lotes do evento, no formulário do organizador (ROADMAP, etapa 6.3; ADR 0018). O preço é
// digitado em reais e vai em centavos (CLAUDE.md, regra 2); as datas, no fuso do evento.

/** Os campos, na ordem da tela, com os nomes do corpo da API (os erros dela batem com eles). */
export const LOT_FIELDS = [
  'name',
  'priceCents',
  'total',
  'maxPerOrder',
  'salesStart',
  'salesEnd',
] as const;
export type LotField = (typeof LOT_FIELDS)[number];

export type LotFormValues = Record<LotField, string>;

const count = (value: number) => value.toLocaleString('pt-BR');

export const LOT_MESSAGES: Record<LotField, string> = {
  name: 'Informe o nome do lote, com até 80 caracteres.',
  priceCents: `Informe o preço em reais, como 80 ou 80,50 (até ${formatCents(CATALOG_LIMITS.maxPriceCents)}).`,
  total: `Informe a quantidade de ingressos, de 1 a ${count(CATALOG_LIMITS.maxTicketsPerType)}.`,
  maxPerOrder: `Informe o limite por pedido, de 1 a ${CATALOG_LIMITS.maxPerOrder}.`,
  salesStart: 'Informe quando as vendas começam.',
  salesEnd: 'Informe quando as vendas terminam.',
};

/** Erros de domínio da API que dizem respeito a um campo do lote. */
export const LOT_CODE_FIELDS: Readonly<Partial<Record<string, LotField>>> = {
  INVALID_SALES_WINDOW: 'salesEnd',
  TICKET_TYPE_TOTAL_BELOW_SOLD: 'total',
};

/** Corpo de `POST` e `PATCH` dos lotes: o schema da API, com as datas em ISO. */
export type LotBody = Omit<CreateTicketTypeRequest, 'salesStart' | 'salesEnd'> & {
  salesStart: string;
  salesEnd: string;
};

interface LotLike {
  name: string;
  priceCents: number;
  total: number;
  available: number;
  maxPerOrder: number;
  salesStart: string;
  salesEnd: string;
}

/** Lote novo: vendas abertas desde agora até o início do evento, 4 por pedido. */
export function newLotValues(
  event: { startsAt: string; timezone: string },
  now: Date,
): LotFormValues {
  return {
    name: '',
    priceCents: '',
    total: '',
    maxPerOrder: '4',
    salesStart: isoToZonedLocal(now.toISOString(), event.timezone),
    salesEnd: isoToZonedLocal(event.startsAt, event.timezone),
  };
}

/** O lote salvo de volta no formulário, para editar. */
export function lotFormValuesOf(lot: LotLike, timeZone: string): LotFormValues {
  return {
    name: lot.name,
    priceCents: centsToReaisInput(lot.priceCents),
    total: String(lot.total),
    maxPerOrder: String(lot.maxPerOrder),
    salesStart: isoToZonedLocal(lot.salesStart, timeZone),
    salesEnd: isoToZonedLocal(lot.salesEnd, timeZone),
  };
}

export function lotFormValuesFrom(form: FormData): LotFormValues {
  const text = (field: LotField) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  };
  return Object.fromEntries(LOT_FIELDS.map((field) => [field, text(field)])) as LotFormValues;
}

/** Inteiro digitado; o resto (vazio, "1,5", "-2") vira NaN e o schema recusa. */
function integerOf(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function lotBodyFrom(
  values: LotFormValues,
  timeZone: string,
): { ok: true; body: LotBody } | { ok: false; errors: FieldErrors<LotField> } {
  const result = validate(
    createTicketTypeRequestSchema,
    {
      name: values.name,
      priceCents: parseReais(values.priceCents) ?? Number.NaN,
      total: integerOf(values.total),
      maxPerOrder: integerOf(values.maxPerOrder),
      salesStart: zonedLocalToIso(values.salesStart, timeZone) ?? '',
      salesEnd: zonedLocalToIso(values.salesEnd, timeZone) ?? '',
    },
    LOT_MESSAGES,
  );
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    body: {
      ...result.data,
      salesStart: result.data.salesStart.toISOString(),
      salesEnd: result.data.salesEnd.toISOString(),
    },
  };
}

/** Só o que mudou no lote, para o PATCH. */
export function lotPatch(original: LotLike, next: LotBody): Partial<LotBody> {
  return changedFields(original, next, ['salesStart', 'salesEnd']);
}

export interface LotSummary {
  price: string;
  stock: string;
  window: string;
  maxPerOrder: string;
}

/** Textos do lote na gestão do evento, com as datas no fuso do evento. */
export function toLotSummary(lot: LotLike, timeZone: string): LotSummary {
  const sold = lot.total - lot.available;
  return {
    price: lot.priceCents === 0 ? 'Grátis' : formatCents(lot.priceCents),
    stock:
      sold === 0
        ? `${count(lot.total)} ingressos, nenhum vendido`
        : `${count(sold)} de ${count(lot.total)} vendidos ou reservados`,
    window: `Vendas de ${formatEventDateShort(lot.salesStart, timeZone)} até ${formatEventDateShort(lot.salesEnd, timeZone)}`,
    maxPerOrder: `Até ${lot.maxPerOrder} por pedido`,
  };
}
