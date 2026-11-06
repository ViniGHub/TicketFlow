import { describe, expect, it } from 'vitest';

import type { EventStatus } from './catalog.js';
import { DomainError } from './domain-error.js';
import {
  assertPurchasable,
  calculateOrderTotal,
  EventNotPublishedError,
  IdempotencyConflictError,
  InsufficientStockError,
  MAX_ORDER_TOTAL_CENTS,
  MaxPerOrderExceededError,
  MIN_PAID_ORDER_TOTAL_CENTS,
  OrderTotalTooLargeError,
  OrderTotalTooSmallError,
  type PurchaseCheck,
  SalesWindowClosedError,
} from './order.js';

const at = (iso: string) => new Date(iso);

describe('total do pedido', () => {
  it('soma preço × quantidade de cada item, em centavos', () => {
    expect(
      calculateOrderTotal([
        { unitPriceCents: 12_050, quantity: 2 },
        { unitPriceCents: 9_990, quantity: 3 },
      ]),
    ).toBe(54_070);
  });

  it('aceita um item só e ingresso gratuito', () => {
    expect(calculateOrderTotal([{ unitPriceCents: 7_500, quantity: 1 }])).toBe(7_500);
    expect(calculateOrderTotal([{ unitPriceCents: 0, quantity: 4 }])).toBe(0);
  });

  it('recusa pedido sem itens', () => {
    expect(() => calculateOrderTotal([])).toThrow(RangeError);
  });

  it.each([0, -1, 1.5])('recusa quantidade %s', (quantity) => {
    expect(() => calculateOrderTotal([{ unitPriceCents: 1_000, quantity }])).toThrow(RangeError);
  });

  it('o limite é o maior valor que o Stripe aceita em qualquer forma de pagamento', () => {
    expect(MAX_ORDER_TOTAL_CENTS).toBe(99_999_999);
    expect(MIN_PAID_ORDER_TOTAL_CENTS).toBe(50);
  });

  it('aceita total exatamente no limite', () => {
    expect(calculateOrderTotal([{ unitPriceCents: MAX_ORDER_TOTAL_CENTS, quantity: 1 }])).toBe(
      MAX_ORDER_TOTAL_CENTS,
    );
  });

  it('recusa total um centavo acima do limite', () => {
    expect(() =>
      calculateOrderTotal([
        { unitPriceCents: MAX_ORDER_TOTAL_CENTS, quantity: 1 },
        { unitPriceCents: 1, quantity: 1 },
      ]),
    ).toThrow(OrderTotalTooLargeError);
  });

  it('recusa o maior pedido que o catálogo permite (R$ 999.999,99 × 100)', () => {
    let caught: unknown;
    try {
      calculateOrderTotal([{ unitPriceCents: 99_999_999, quantity: 100 }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OrderTotalTooLargeError);
    expect(caught).toMatchObject({ code: 'ORDER_TOTAL_TOO_LARGE', totalCents: 9_999_999_900 });
  });

  it('aceita o mínimo de cobrança do Stripe em BRL', () => {
    expect(calculateOrderTotal([{ unitPriceCents: 25, quantity: 2 }])).toBe(50);
  });

  it.each([1, 49])('recusa total pago de %s centavo(s), abaixo do mínimo do Stripe', (total) => {
    let caught: unknown;
    try {
      calculateOrderTotal([{ unitPriceCents: total, quantity: 1 }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OrderTotalTooSmallError);
    expect(caught).toMatchObject({ code: 'ORDER_TOTAL_TOO_SMALL', totalCents: total });
  });
});

describe('validações antes de reservar', () => {
  const now = at('2026-11-20T12:00:00Z');

  function check(
    overrides: {
      status?: EventStatus;
      salesStart?: Date;
      salesEnd?: Date;
      maxPerOrder?: number;
      quantity?: number;
    } = {},
  ): PurchaseCheck {
    return {
      event: { id: 'evento-1', status: overrides.status ?? 'PUBLISHED' },
      ticketType: {
        id: 'lote-1',
        salesStart: overrides.salesStart ?? at('2026-11-01T00:00:00Z'),
        salesEnd: overrides.salesEnd ?? at('2026-12-01T00:00:00Z'),
        maxPerOrder: overrides.maxPerOrder ?? 4,
      },
      quantity: overrides.quantity ?? 2,
    };
  }

  it('aceita evento publicado, vendas abertas e quantidade dentro do limite', () => {
    expect(() => assertPurchasable(check(), now)).not.toThrow();
  });

  it.each<EventStatus>(['DRAFT', 'CANCELLED'])('recusa evento %s', (status) => {
    expect(() => assertPurchasable(check({ status }), now)).toThrow(EventNotPublishedError);
  });

  it('o início das vendas é inclusivo', () => {
    expect(() => assertPurchasable(check({ salesStart: now }), now)).not.toThrow();
    expect(() =>
      assertPurchasable(check({ salesStart: at('2026-11-20T12:00:00.001Z') }), now),
    ).toThrow(new SalesWindowClosedError('lote-1', 'not-started'));
  });

  it('o fim das vendas é exclusivo', () => {
    expect(() =>
      assertPurchasable(check({ salesEnd: at('2026-11-20T12:00:00.001Z') }), now),
    ).not.toThrow();
    expect(() => assertPurchasable(check({ salesEnd: now }), now)).toThrow(
      new SalesWindowClosedError('lote-1', 'ended'),
    );
  });

  it('aceita exatamente max_per_order e recusa um a mais', () => {
    expect(() => assertPurchasable(check({ maxPerOrder: 4, quantity: 4 }), now)).not.toThrow();

    let caught: unknown;
    try {
      assertPurchasable(check({ maxPerOrder: 4, quantity: 5 }), now);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MaxPerOrderExceededError);
    expect(caught).toMatchObject({ ticketTypeId: 'lote-1', maxPerOrder: 4, requested: 5 });
  });

  it('evento fora de venda tem precedência sobre as regras do lote', () => {
    expect(() =>
      assertPurchasable(check({ status: 'DRAFT', salesEnd: now, quantity: 99 }), now),
    ).toThrow(EventNotPublishedError);
  });
});

describe('erros do pedido', () => {
  it.each([
    [new InsufficientStockError('lote-1'), 'INSUFFICIENT_STOCK'],
    [new SalesWindowClosedError('lote-1', 'ended'), 'SALES_WINDOW_CLOSED'],
    [new MaxPerOrderExceededError('lote-1', 4, 5), 'MAX_PER_ORDER_EXCEEDED'],
    [new EventNotPublishedError('evento-1'), 'EVENT_NOT_PUBLISHED'],
    [new IdempotencyConflictError(), 'IDEMPOTENCY_CONFLICT'],
    [new OrderTotalTooLargeError(MAX_ORDER_TOTAL_CENTS + 1), 'ORDER_TOTAL_TOO_LARGE'],
    [new OrderTotalTooSmallError(1), 'ORDER_TOTAL_TOO_SMALL'],
  ] as const)('%s tem o código %s', (error, code) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
    expect(error.message).not.toBe('');
  });
});
