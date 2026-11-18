import { type TicketTypeResponse } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { isUuid, lotSaleState, toEventCard, toLotView } from './view';

const NOW = new Date('2026-11-20T12:00:00Z');
const TZ = 'America/Sao_Paulo';

const lot = (overrides: Partial<TicketTypeResponse> = {}): TicketTypeResponse => ({
  id: '0193a4f2-0000-7000-8000-00000000000a',
  name: 'Pista',
  priceCents: 8_000,
  total: 100,
  available: 40,
  salesStart: '2026-11-01T00:00:00.000Z',
  salesEnd: '2026-12-20T00:00:00.000Z',
  maxPerOrder: 4,
  ...overrides,
});

describe('lotSaleState', () => {
  it('à venda: até o limite por pedido', () => {
    expect(lotSaleState(lot(), NOW, TZ)).toEqual({ type: 'on-sale', maxQuantity: 4 });
  });

  it('com menos disponíveis que o limite, o máximo é o que sobrou', () => {
    expect(lotSaleState(lot({ available: 2 }), NOW, TZ)).toEqual({
      type: 'on-sale',
      maxQuantity: 2,
    });
  });

  it('sem estoque: esgotado', () => {
    expect(lotSaleState(lot({ available: 0 }), NOW, TZ)).toEqual({ type: 'sold-out' });
  });

  it('antes da abertura, diz quando abre, no fuso do evento', () => {
    const state = lotSaleState(lot({ salesStart: '2026-11-25T13:00:00.000Z' }), NOW, TZ);

    expect(state).toMatchObject({ type: 'not-started' });
    expect(state.type === 'not-started' && state.label).toBe('Abre qua., 25 de nov. · 10:00');
  });

  it('depois do fim da janela: encerrado, mesmo com estoque', () => {
    expect(lotSaleState(lot({ salesEnd: '2026-11-20T12:00:00.000Z' }), NOW, TZ)).toEqual({
      type: 'ended',
    });
  });
});

describe('visões do catálogo', () => {
  it('o cartão leva a data curta no fuso do evento', () => {
    const card = toEventCard({
      id: 'e1',
      title: 'Show',
      venue: 'Teatro',
      timezone: TZ,
      startsAt: '2026-12-20T23:00:00.000Z',
      status: 'PUBLISHED',
    });

    expect(card.dateLabel).toMatch(/20:00$/);
  });

  it('lote grátis aparece como Grátis', () => {
    expect(toLotView(lot({ priceCents: 0 }), NOW, TZ).priceLabel).toBe('Grátis');
    expect(toLotView(lot(), NOW, TZ).priceLabel).toBe('R$ 80,00');
  });

  it('só uuid chega à API', () => {
    expect(isUuid('0193a4f2-0000-7000-8000-00000000000a')).toBe(true);
    expect(isUuid('../admin')).toBe(false);
  });
});
