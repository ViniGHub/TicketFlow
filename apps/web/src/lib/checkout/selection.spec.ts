import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '../api/errors';

import {
  attemptFor,
  keepsAttemptAfter,
  orderItems,
  selectionTotal,
  setQuantity,
  tooManyLots,
} from './selection';

const A = '0193a4f2-0000-7000-8000-00000000000a';
const B = '0193a4f2-0000-7000-8000-00000000000b';

describe('seleção', () => {
  it('a quantidade fica entre 0 e o máximo do lote', () => {
    expect(setQuantity({}, A, 3, 2)).toEqual({ [A]: 2 });
    expect(setQuantity({ [A]: 1 }, A, -1, 4)).toEqual({ [A]: 0 });
  });

  it('o pedido leva só os lotes escolhidos, em ordem de id', () => {
    expect(orderItems({ [B]: 1, [A]: 2, outro: 0 })).toEqual([
      { ticketTypeId: A, quantity: 2 },
      { ticketTypeId: B, quantity: 1 },
    ]);
  });

  it('o total soma preço × quantidade, em centavos', () => {
    const lots = [
      { id: A, priceCents: 8_000 },
      { id: B, priceCents: 4_000 },
    ];

    expect(selectionTotal({ [A]: 2, [B]: 1 }, lots)).toBe(20_000);
    expect(selectionTotal({}, lots)).toBe(0);
  });

  it('mais de 10 lotes diferentes não cabem num pedido', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      ticketTypeId: `lote-${i}`,
      quantity: 1,
    }));

    expect(tooManyLots(items)).toBe(true);
    expect(tooManyLots(items.slice(0, 10))).toBe(false);
  });
});

describe('tentativa de compra', () => {
  let counter = 0;
  const newKey = () => `chave-${++counter}`;

  it('a mesma seleção repete a mesma Idempotency-Key', () => {
    const items = orderItems({ [A]: 2 });
    const first = attemptFor(null, items, newKey);

    expect(attemptFor(first, orderItems({ [A]: 2 }), newKey)).toBe(first);
  });

  it('mudar a seleção começa outra tentativa, com chave nova', () => {
    const first = attemptFor(null, orderItems({ [A]: 2 }), newKey);
    const second = attemptFor(first, orderItems({ [A]: 3 }), newKey);

    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('só a falha de rede mantém a tentativa: qualquer resposta da API a encerra', () => {
    expect(keepsAttemptAfter(networkError())).toBe(true);
    expect(keepsAttemptAfter(new ApiError(503, 'CHECKOUT_UNAVAILABLE', ''))).toBe(false);
    expect(keepsAttemptAfter(new ApiError(409, 'INSUFFICIENT_STOCK', ''))).toBe(false);
  });
});
