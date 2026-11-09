import { describe, expect, it } from 'vitest';

import { FAKE_NOW, FakeDatabase } from './fake-database.test-helper.js';
import { InsufficientStockError, type Order } from './order.js';
import { InvalidOrderTransitionError } from './order-status.js';
import { transitionOrder } from './order-transition.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';

function setup(status: Order['status'], available = { a: 8, b: 9 }) {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: available.a });
  db.addTicketType(lotB, { available: available.b });
  // Itens fora de ordem de propósito: o efeito no estoque segue a ordem dos lotes.
  const order = db.addOrder('pedido-1', {
    status,
    items: [
      { ticketTypeId: lotB, quantity: 1, unitPriceCents: 4_000 },
      { ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 },
    ],
  });
  return { db, order };
}

describe('transição de pedido', () => {
  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'PENDING → %s devolve o estoque em ordem de lote e grava o status',
    async (to) => {
      const { db, order } = setup('PENDING');

      const result = await db.run((repositories) => transitionOrder(repositories, order, to));

      expect(result.status).toBe(to);
      expect(db.order('pedido-1')?.status).toBe(to);
      expect(db.releases).toEqual([
        { ticketTypeId: lotA, quantity: 2 },
        { ticketTypeId: lotB, quantity: 1 },
      ]);
      expect(db.available(lotA)).toBe(10);
      expect(db.available(lotB)).toBe(10);
    },
  );

  it('PENDING → PAID não mexe no estoque e grava os campos que mudam junto', async () => {
    const { db, order } = setup('PENDING');

    const result = await db.run((repositories) =>
      transitionOrder(repositories, order, 'PAID', { paidAt: FAKE_NOW }),
    );

    expect(result).toMatchObject({ status: 'PAID', paidAt: FAKE_NOW });
    expect(db.order('pedido-1')).toMatchObject({ status: 'PAID', paidAt: FAKE_NOW });
    expect(db.releases).toEqual([]);
    expect(db.reservations).toEqual([]);
  });

  it('EXPIRED → PAID reserva o estoque de novo', async () => {
    const { db, order } = setup('EXPIRED', { a: 10, b: 10 });

    await db.run((repositories) => transitionOrder(repositories, order, 'PAID'));

    expect(db.reservations).toEqual([lotA, lotB]);
    expect(db.available(lotA)).toBe(8);
    expect(db.available(lotB)).toBe(9);
  });

  it('EXPIRED → PAID sem estoque lança e não muda nada', async () => {
    const { db, order } = setup('EXPIRED', { a: 10, b: 0 });

    await expect(
      db.run((repositories) => transitionOrder(repositories, order, 'PAID')),
    ).rejects.toThrow(new InsufficientStockError(lotB));
    expect(db.order('pedido-1')?.status).toBe('EXPIRED');
    expect(db.available(lotA)).toBe(10);
  });

  it('EXPIRED → PAID sem estoque devolve o que já reservou, mesmo sem rollback', async () => {
    const { db, order } = setup('EXPIRED', { a: 10, b: 0 });

    // Quem chama captura o erro e segue na mesma transação (pagamento tardio, etapa 4.3).
    const caught = await db.run((repositories) =>
      transitionOrder(repositories, order, 'PAID').catch((error: unknown) => error),
    );

    expect(caught).toEqual(new InsufficientStockError(lotB));
    expect(db.reservations).toEqual([lotA, lotB]);
    expect(db.releases).toEqual([{ ticketTypeId: lotA, quantity: 2 }]);
    expect(db.available(lotA)).toBe(10);
    expect(db.order('pedido-1')?.status).toBe('EXPIRED');
  });

  it('transição fora da tabela lança antes de mexer no estoque', async () => {
    const { db, order } = setup('PAID');

    await expect(
      db.run((repositories) => transitionOrder(repositories, order, 'EXPIRED')),
    ).rejects.toThrow(InvalidOrderTransitionError);
    expect(db.releases).toEqual([]);
    expect(db.order('pedido-1')?.status).toBe('PAID');
  });
});
