import { describe, expect, it } from 'vitest';

import { InvalidMoneyError, assertCents, multiplyCents, sumCents } from './money.js';

describe('money', () => {
  it('aceita centavos inteiros e não negativos', () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(4990)).toBe(4990);
  });

  it.each([-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY])('rejeita %s', (value) => {
    expect(() => assertCents(value)).toThrow(InvalidMoneyError);
  });

  it('multiplica preço unitário pela quantidade', () => {
    expect(multiplyCents(2500, 3)).toBe(7500);
  });

  it('rejeita quantidade fracionária', () => {
    expect(() => multiplyCents(2500, 1.5)).toThrow(RangeError);
  });

  it('soma valores', () => {
    expect(sumCents([1000, 2550, 0])).toBe(3550);
    expect(sumCents([])).toBe(0);
  });

  it('expõe um código estável para mapear o erro na API', () => {
    expect(new InvalidMoneyError(-1).code).toBe('INVALID_MONEY');
  });
});
