import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CATALOG_LIMITS,
  createEventRequestSchema,
  createTicketTypeRequestSchema,
  eventPageSchema,
  eventSummaryPageSchema,
  listEventsQuerySchema,
  myEventsQuerySchema,
  ticketTypeResponseSchema,
  timeZoneSchema,
  updateEventRequestSchema,
  updateTicketTypeRequestSchema,
} from './events.js';

describe('timeZoneSchema', () => {
  it.each([
    ['America/Sao_Paulo', 'America/Sao_Paulo'],
    ['  america/sao_paulo ', 'America/Sao_Paulo'],
    ['UTC', 'UTC'],
    ['America/Recife', 'America/Recife'],
  ])('aceita %j como %s', (input, expected) => {
    expect(timeZoneSchema.parse(input)).toBe(expected);
  });

  it.each(['-03:00', '+03:00', 'Mars/Phobos', '', 'GMT-3x'])('recusa %j', (input) => {
    expect(timeZoneSchema.safeParse(input).success).toBe(false);
  });
});

describe('createEventRequestSchema', () => {
  const valid = {
    title: 'Jazz no Parque',
    venue: 'Parque Ibirapuera',
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-12-10T20:00:00-03:00',
  };

  it('converte a data para UTC e assume descrição vazia', () => {
    expect(createEventRequestSchema.parse(valid)).toEqual({
      ...valid,
      description: '',
      startsAt: new Date('2026-12-10T23:00:00Z'),
    });
  });

  it.each([
    ['data sem fuso', { startsAt: '2026-12-10T20:00:00' }],
    ['só a data', { startsAt: '2026-12-10' }],
    ['título vazio', { title: '  ' }],
    ['título longo demais', { title: 'x'.repeat(121) }],
    ['fuso como offset', { timezone: '-03:00' }],
  ])('recusa %s', (_case, override) => {
    expect(createEventRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe('updateEventRequestSchema', () => {
  it('aceita só os campos enviados, sem preencher padrões', () => {
    expect(updateEventRequestSchema.parse({ title: 'Novo título' })).toEqual({
      title: 'Novo título',
    });
  });

  it('recusa corpo vazio ou só com campos desconhecidos', () => {
    expect(updateEventRequestSchema.safeParse({}).success).toBe(false);
    expect(updateEventRequestSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
  });
});

describe('createTicketTypeRequestSchema', () => {
  const valid = {
    name: 'Pista',
    priceCents: 8000,
    total: 100,
    salesStart: '2026-11-01T00:00:00Z',
    salesEnd: '2026-12-10T19:00:00-03:00',
    maxPerOrder: 4,
  };

  it('aceita um lote válido, inclusive gratuito', () => {
    expect(createTicketTypeRequestSchema.parse({ ...valid, priceCents: 0 })).toMatchObject({
      priceCents: 0,
      salesEnd: new Date('2026-12-10T22:00:00Z'),
    });
  });

  it.each([
    ['preço negativo', { priceCents: -1 }],
    ['preço fracionário', { priceCents: 10.5 }],
    ['preço como texto', { priceCents: '8000' }],
    ['preço acima do limite', { priceCents: CATALOG_LIMITS.maxPriceCents + 1 }],
    ['total zero', { total: 0 }],
    ['total acima do limite', { total: CATALOG_LIMITS.maxTicketsPerType + 1 }],
    ['máximo por pedido zero', { maxPerOrder: 0 }],
    ['nome vazio', { name: '' }],
  ])('recusa %s', (_case, override) => {
    expect(createTicketTypeRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('edição aceita um campo só e recusa corpo vazio', () => {
    expect(updateTicketTypeRequestSchema.parse({ total: 80 })).toEqual({ total: 80 });
    expect(updateTicketTypeRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('listEventsQuerySchema', () => {
  it('usa o tamanho de página padrão e converte o limite da query string', () => {
    expect(listEventsQuerySchema.parse({})).toEqual({ limit: CATALOG_LIMITS.defaultPageSize });
    expect(listEventsQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it.each([
    ['limite zero', { limit: '0' }],
    ['limite acima do máximo', { limit: String(CATALOG_LIMITS.maxPageSize + 1) }],
    ['limite fracionário', { limit: '2.5' }],
    ['from depois de to', { from: '2026-12-02T00:00:00Z', to: '2026-12-01T00:00:00Z' }],
    ['from igual a to', { from: '2026-12-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }],
  ])('recusa %s', (_case, query) => {
    expect(listEventsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('a listagem do organizador aceita só cursor e limite', () => {
    expect(myEventsQuerySchema.parse({ cursor: 'abc', limit: '3', from: 'x' })).toEqual({
      cursor: 'abc',
      limit: 3,
    });
  });
});

describe('OpenAPI', () => {
  // Os schemas viram documentação do Swagger quando a API carrega: um schema que o zod não
  // consegue converter derrubaria a aplicação no boot.
  it.each([
    ['createEventRequestSchema', createEventRequestSchema],
    ['updateEventRequestSchema', updateEventRequestSchema],
    ['createTicketTypeRequestSchema', createTicketTypeRequestSchema],
    ['updateTicketTypeRequestSchema', updateTicketTypeRequestSchema],
  ])('%s gera o schema de entrada', (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' })).toMatchObject({
      type: 'object',
    });
  });

  it.each([
    ['ticketTypeResponseSchema', ticketTypeResponseSchema],
    ['eventSummaryPageSchema', eventSummaryPageSchema],
    ['eventPageSchema', eventPageSchema],
  ])('%s gera o schema de saída', (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: 'output', target: 'openapi-3.0' })).toMatchObject({
      type: 'object',
    });
  });
});
