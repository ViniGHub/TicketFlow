import { describe, expect, it } from 'vitest';

import { summarizeSales } from './sales.js';

const pista = { id: 'lote-pista', name: 'Pista', priceCents: 8_000, total: 100, available: 90 };
const vip = { id: 'lote-vip', name: 'VIP', priceCents: 20_000, total: 10, available: 10 };

describe('vendas do evento', () => {
  it('vendido e receita só de pedidos pagos; reservado de PENDING e PROCESSING', () => {
    const sales = summarizeSales(
      [pista],
      [
        { ticketTypeId: pista.id, status: 'PAID', quantity: 5, amountCents: 40_000 },
        { ticketTypeId: pista.id, status: 'PENDING', quantity: 2, amountCents: 16_000 },
        { ticketTypeId: pista.id, status: 'PROCESSING', quantity: 1, amountCents: 8_000 },
        { ticketTypeId: pista.id, status: 'REFUNDED', quantity: 1, amountCents: 8_000 },
        { ticketTypeId: pista.id, status: 'REFUND_PENDING', quantity: 1, amountCents: 8_000 },
        { ticketTypeId: pista.id, status: 'EXPIRED', quantity: 3, amountCents: 24_000 },
        { ticketTypeId: pista.id, status: 'CANCELLED', quantity: 4, amountCents: 32_000 },
      ],
      [],
    );

    expect(sales.ticketTypes).toEqual([{ ...pista, sold: 5, reserved: 3, revenueCents: 40_000 }]);
  });

  it('a receita usa o preço gravado no pedido, não o preço atual do lote', () => {
    const sales = summarizeSales(
      [{ ...pista, priceCents: 12_000 }],
      [{ ticketTypeId: pista.id, status: 'PAID', quantity: 2, amountCents: 16_000 }],
      [],
    );

    expect(sales.totals.revenueCents).toBe(16_000);
  });

  it('lote sem venda aparece zerado, e os totais somam os lotes', () => {
    const sales = summarizeSales(
      [pista, vip],
      [
        { ticketTypeId: pista.id, status: 'PAID', quantity: 5, amountCents: 40_000 },
        { ticketTypeId: pista.id, status: 'PENDING', quantity: 2, amountCents: 16_000 },
      ],
      [],
    );

    expect(sales.ticketTypes[1]).toEqual({ ...vip, sold: 0, reserved: 0, revenueCents: 0 });
    expect(sales.totals).toEqual({ sold: 5, reserved: 2, revenueCents: 40_000 });
  });

  it('pedidos por status trazem todos os status, mesmo com zero', () => {
    const sales = summarizeSales(
      [pista],
      [],
      [
        { status: 'PAID', orders: 3 },
        { status: 'EXPIRED', orders: 1 },
      ],
    );

    expect(sales.ordersByStatus).toEqual({
      PENDING: 0,
      PROCESSING: 0,
      PAID: 3,
      EXPIRED: 1,
      CANCELLED: 0,
      REFUND_PENDING: 0,
      REFUNDED: 0,
    });
  });

  it('evento sem lotes: tudo zerado', () => {
    const sales = summarizeSales([], [], []);

    expect(sales.ticketTypes).toEqual([]);
    expect(sales.totals).toEqual({ sold: 0, reserved: 0, revenueCents: 0 });
  });
});
