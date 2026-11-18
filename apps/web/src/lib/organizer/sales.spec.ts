import { describe, expect, it } from 'vitest';

import { formatCents } from '../format';

import { type SalesData, toSalesView } from './sales';

const lot = {
  ticketTypeId: '0193a4f2-0000-7000-8000-0000000000f1',
  name: 'Pista',
  priceCents: 8_000,
  total: 200,
  available: 32,
  sold: 163,
  reserved: 5,
  revenueCents: 1_304_000,
};

const sales: SalesData = {
  eventId: '0193a4f2-0000-7000-8000-0000000000e1',
  currency: 'BRL',
  ticketTypes: [
    lot,
    {
      ...lot,
      ticketTypeId: 'vip',
      name: 'VIP',
      total: 10,
      available: 10,
      sold: 0,
      reserved: 0,
      revenueCents: 0,
    },
  ],
  totals: { sold: 163, reserved: 5, revenueCents: 1_304_000 },
  ordersByStatus: { PAID: 40, PENDING: 2 },
};

describe('toSalesView', () => {
  it('totais: receita em reais e vendidos sobre a capacidade de todos os lotes', () => {
    const view = toSalesView(sales);

    expect(view.revenue).toBe(formatCents(1_304_000));
    expect(view.sold).toBe('163 de 210');
    expect(view.reserved).toBe('5');
  });

  it('cada lote com os números e as partes da barra; parte zerada não entra', () => {
    const [pista, vip] = toSalesView(sales).lots;

    expect(pista?.figures).toBe('163 vendidos · 5 reservados · 32 disponíveis de 200');
    expect(pista?.parts).toEqual([
      { part: 'sold', value: 163 },
      { part: 'reserved', value: 5 },
      { part: 'available', value: 32 },
    ]);
    expect(pista?.label).toBe(`Pista: ${pista?.figures}`);
    expect(vip?.parts).toEqual([{ part: 'available', value: 10 }]);
  });

  it('o que sai da conta (ex.: reembolso que não volta ao estoque) fica de sobra na barra', () => {
    const [refunded] = toSalesView({
      ...sales,
      ticketTypes: [{ ...lot, sold: 150 }],
    }).lots;

    expect(refunded?.rest).toBe(13);
  });

  it('todos os status de pedido aparecem, mesmo com zero, na ordem do caminho do pedido', () => {
    const orders = toSalesView(sales).orders;

    expect(orders.map((order) => order.status)).toEqual([
      'PAID',
      'PENDING',
      'PROCESSING',
      'EXPIRED',
      'CANCELLED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
    expect(orders[0]).toEqual({ status: 'PAID', label: 'Pagos', count: 40 });
    expect(orders.at(-1)?.count).toBe(0);
  });
});
