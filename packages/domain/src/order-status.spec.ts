import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  InvalidOrderTransitionError,
  ORDER_STATUSES,
  type OrderStatus,
  type StockEffect,
  stockEffectOf,
} from './order-status.js';

// Copiado da tabela da seção 4 do ARCHITECTURE.md, sem importar a tabela do código: o teste
// confere a implementação contra o documento, não contra ela mesma.
const ALLOWED: ReadonlyArray<readonly [OrderStatus, OrderStatus, StockEffect]> = [
  ['PENDING', 'PAID', 'none'],
  ['PENDING', 'PROCESSING', 'none'],
  ['PROCESSING', 'PAID', 'none'],
  ['PROCESSING', 'EXPIRED', 'release'],
  ['PENDING', 'EXPIRED', 'release'],
  ['PENDING', 'CANCELLED', 'release'],
  ['EXPIRED', 'PAID', 'reserve'],
  ['EXPIRED', 'REFUND_PENDING', 'none'],
  ['PAID', 'REFUND_PENDING', 'none'],
  ['REFUND_PENDING', 'REFUNDED', 'none'],
];

function expectedEffect(from: OrderStatus, to: OrderStatus): StockEffect | undefined {
  return ALLOWED.find(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)?.[2];
}

const allPairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => ({ from, to })));
const allowedPairs = allPairs.flatMap(({ from, to }) => {
  const effect = expectedEffect(from, to);
  return effect === undefined ? [] : [[from, to, effect] as const];
});
const forbiddenPairs = allPairs
  .filter(({ from, to }) => expectedEffect(from, to) === undefined)
  .map(({ from, to }) => [from, to] as const);

describe('estados do pedido', () => {
  it('são os 7 da seção 4, sem repetição', () => {
    expect(new Set(ORDER_STATUSES).size).toBe(ORDER_STATUSES.length);
    expect([...ORDER_STATUSES].sort()).toEqual(
      [
        'CANCELLED',
        'EXPIRED',
        'PAID',
        'PENDING',
        'PROCESSING',
        'REFUNDED',
        'REFUND_PENDING',
      ].sort(),
    );
  });

  it('a tabela do teste cobre os 49 pares: 10 permitidos e 39 recusados', () => {
    expect(allPairs).toHaveLength(49);
    expect(allowedPairs).toHaveLength(ALLOWED.length);
    expect(allowedPairs).toHaveLength(10);
    expect(forbiddenPairs).toHaveLength(39);
  });
});

describe('transições do pedido (todos os pares origem × destino)', () => {
  it.each(allowedPairs)('%s → %s é permitida (estoque: %s)', (from, to, effect) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
    expect(stockEffectOf(from, to)).toBe(effect);
  });

  it.each(forbiddenPairs)('%s → %s é recusada', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidOrderTransitionError);
    expect(() => stockEffectOf(from, to)).toThrow(InvalidOrderTransitionError);
  });

  it('o erro informa a origem, o destino e o código', () => {
    let caught: unknown;
    try {
      assertTransition('PAID', 'PENDING');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidOrderTransitionError);
    expect(caught).toMatchObject({
      code: 'INVALID_ORDER_TRANSITION',
      from: 'PAID',
      to: 'PENDING',
      name: 'InvalidOrderTransitionError',
      message: 'Pedido em PAID não pode passar para PENDING.',
    });
  });
});
