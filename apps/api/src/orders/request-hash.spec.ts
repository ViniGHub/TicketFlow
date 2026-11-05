import { describe, expect, it } from 'vitest';

import { orderRequestHash } from './request-hash';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';

describe('orderRequestHash', () => {
  it('é um SHA-256 em hexadecimal', () => {
    expect(orderRequestHash([{ ticketTypeId: lotA, quantity: 1 }])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('não depende da ordem dos itens nem da caixa do id', () => {
    const hash = orderRequestHash([
      { ticketTypeId: lotA, quantity: 2 },
      { ticketTypeId: lotB, quantity: 1 },
    ]);
    expect(
      orderRequestHash([
        { ticketTypeId: lotB.toUpperCase(), quantity: 1 },
        { ticketTypeId: lotA, quantity: 2 },
      ]),
    ).toBe(hash);
  });

  it('muda com a quantidade ou com o lote', () => {
    const hash = orderRequestHash([{ ticketTypeId: lotA, quantity: 2 }]);
    expect(orderRequestHash([{ ticketTypeId: lotA, quantity: 3 }])).not.toBe(hash);
    expect(orderRequestHash([{ ticketTypeId: lotB, quantity: 2 }])).not.toBe(hash);
  });
});
