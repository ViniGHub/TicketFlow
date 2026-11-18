import { describe, expect, it } from 'vitest';

import { formatCents } from '../format';

import {
  LOT_MESSAGES,
  lotBodyFrom,
  lotFormValuesOf,
  lotPatch,
  newLotValues,
  toLotSummary,
} from './lots';

const TZ = 'America/Sao_Paulo';

const filled = {
  name: ' Pista ',
  priceCents: '80,50',
  total: '200',
  maxPerOrder: '4',
  salesStart: '2026-11-20T10:00',
  salesEnd: '2026-12-20T19:00',
};

const saved = {
  name: 'Pista',
  priceCents: 8_050,
  total: 200,
  available: 37,
  maxPerOrder: 4,
  salesStart: '2026-11-20T13:00:00.000Z',
  salesEnd: '2026-12-20T22:00:00.000Z',
};

describe('lotBodyFrom', () => {
  it('reais viram centavos e as datas valem no fuso do evento', () => {
    expect(lotBodyFrom(filled, TZ)).toEqual({
      ok: true,
      body: {
        name: 'Pista',
        priceCents: 8_050,
        total: 200,
        maxPerOrder: 4,
        salesStart: '2026-11-20T13:00:00.000Z',
        salesEnd: '2026-12-20T22:00:00.000Z',
      },
    });
  });

  it('lote gratuito é aceito', () => {
    const result = lotBodyFrom({ ...filled, priceCents: '0' }, TZ);
    expect(result.ok && result.body.priceCents).toBe(0);
  });

  it.each([
    ['preço com ponto decimal', { priceCents: '80.5' }, 'priceCents'],
    ['preço acima do limite', { priceCents: '1.000.000,00' }, 'priceCents'],
    ['quantidade quebrada', { total: '1,5' }, 'total'],
    ['quantidade zero', { total: '0' }, 'total'],
    ['limite por pedido vazio', { maxPerOrder: '' }, 'maxPerOrder'],
    ['limite por pedido acima de 100', { maxPerOrder: '101' }, 'maxPerOrder'],
    ['nome vazio', { name: '  ' }, 'name'],
    ['fim das vendas vazio', { salesEnd: '' }, 'salesEnd'],
  ] as const)('%s: erro no campo', (_case, override, field) => {
    const result = lotBodyFrom({ ...filled, ...override }, TZ);
    expect(result).toEqual({ ok: false, errors: { [field]: LOT_MESSAGES[field] } });
  });
});

describe('formulário do lote', () => {
  it('lote novo: vendas de agora até o início do evento, no fuso dele', () => {
    const values = newLotValues(
      { startsAt: '2026-12-21T00:00:00.000Z', timezone: 'America/Manaus' },
      new Date('2026-11-18T15:30:45.000Z'),
    );
    expect(values).toMatchObject({
      salesStart: '2026-11-18T11:30',
      salesEnd: '2026-12-20T20:00',
      maxPerOrder: '4',
    });
  });

  it('o lote salvo volta ao formulário em reais e no fuso do evento', () => {
    expect(lotFormValuesOf(saved, TZ)).toEqual({
      name: 'Pista',
      priceCents: '80,50',
      total: '200',
      maxPerOrder: '4',
      salesStart: '2026-11-20T10:00',
      salesEnd: '2026-12-20T19:00',
    });
  });
});

describe('lotPatch', () => {
  it('leva só o que mudou; a mesma hora em outro formato não é mudança', () => {
    const result = lotBodyFrom({ ...filled, total: '300' }, TZ);
    if (!result.ok) {
      throw new Error('lote de teste inválido');
    }
    expect(lotPatch({ ...saved, salesEnd: '2026-12-20T22:00:00Z' }, result.body)).toEqual({
      total: 300,
    });
  });
});

describe('toLotSummary', () => {
  it('preço, vendidos e janela de vendas no fuso do evento', () => {
    const summary = toLotSummary(saved, TZ);
    expect(summary.price).toBe(formatCents(8_050));
    expect(summary.stock).toBe('163 de 200 vendidos ou reservados');
    expect(summary.window).toContain('10:00');
    expect(summary.maxPerOrder).toBe('Até 4 por pedido');
  });

  it('lote gratuito e sem vendas', () => {
    const summary = toLotSummary({ ...saved, priceCents: 0, available: 200 }, TZ);
    expect(summary.price).toBe('Grátis');
    expect(summary.stock).toBe('200 ingressos, nenhum vendido');
  });
});
