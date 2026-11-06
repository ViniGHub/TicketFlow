import { describe, expect, it } from 'vitest';

import { FakeDatabase } from './fake-database.test-helper.js';
import { generateQrToken, QR_TOKEN_BYTES, ticketsFor } from './tickets.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';

describe('qr_token', () => {
  it('tem 32 bytes aleatórios em base64url, sem padding', () => {
    const token = generateQrToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(QR_TOKEN_BYTES);
  });

  it('não se repete', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => generateQrToken()));

    expect(tokens.size).toBe(1_000);
  });
});

describe('ingressos do pedido', () => {
  it('emite um ingresso por unidade, na ordem dos itens', () => {
    const order = new FakeDatabase().addOrder('pedido-1', {
      items: [
        { ticketTypeId: lotB, quantity: 2, unitPriceCents: 5_000 },
        { ticketTypeId: lotA, quantity: 1, unitPriceCents: 8_000 },
      ],
    });
    let next = 0;

    const tickets = ticketsFor(order, () => `qr-${++next}`);

    expect(tickets).toEqual([
      { orderId: 'pedido-1', ticketTypeId: lotB, qrToken: 'qr-1' },
      { orderId: 'pedido-1', ticketTypeId: lotB, qrToken: 'qr-2' },
      { orderId: 'pedido-1', ticketTypeId: lotA, qrToken: 'qr-3' },
    ]);
  });

  it('usa tokens aleatórios por padrão', () => {
    const order = new FakeDatabase().addOrder('pedido-1', {
      items: [{ ticketTypeId: lotA, quantity: 3, unitPriceCents: 8_000 }],
    });

    const tokens = ticketsFor(order).map((ticket) => ticket.qrToken);

    expect(new Set(tokens).size).toBe(3);
  });
});
