import { describe, expect, it } from 'vitest';

import { TicketTypeNotFoundError } from './catalog.js';
import { FAKE_NOW, FakeDatabase } from './fake-database.test-helper.js';
import {
  EventNotPublishedError,
  IdempotencyConflictError,
  InsufficientStockError,
  OrderTotalTooLargeError,
  SalesWindowClosedError,
} from './order.js';
import { placeOrder, type PlaceOrderInput } from './place-order.js';

const now = FAKE_NOW;
const options = { now, reservationTtlMinutes: 30 };
const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';

function setup() {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { priceCents: 8_000 });
  db.addTicketType(lotB, { priceCents: 4_000 });
  return db;
}

const buy = (items: PlaceOrderInput['items'], idempotency?: PlaceOrderInput['idempotency']) => ({
  userId: 'comprador-1',
  items,
  ...(idempotency && { idempotency }),
});

describe('criação de pedido', () => {
  it('cria o pedido PENDING com o preço do lote e a reserva valendo pelo TTL', async () => {
    const db = setup();
    const { order, replayed } = await placeOrder(
      db,
      buy([
        { ticketTypeId: lotA, quantity: 2 },
        { ticketTypeId: lotB, quantity: 1 },
      ]),
      options,
    );

    expect(replayed).toBe(false);
    expect(order).toMatchObject({
      status: 'PENDING',
      userId: 'comprador-1',
      totalCents: 20_000,
      expiresAt: new Date('2026-11-20T12:30:00Z'),
      idempotencyKey: null,
      requestHash: null,
      items: [
        { ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 },
        { ticketTypeId: lotB, quantity: 1, unitPriceCents: 4_000 },
      ],
    });
    expect(db.available(lotA)).toBe(8);
    expect(db.available(lotB)).toBe(9);
  });

  it('reserva em ordem de id, qualquer que seja a ordem do pedido', async () => {
    const db = setup();
    await placeOrder(
      db,
      buy([
        { ticketTypeId: lotB, quantity: 1 },
        { ticketTypeId: lotA, quantity: 1 },
      ]),
      options,
    );
    expect(db.reservations).toEqual([lotA, lotB]);
  });

  it('valida todos os itens antes de reservar qualquer um', async () => {
    const db = setup();
    db.addTicketType(lotB, { salesEnd: now });

    await expect(
      placeOrder(
        db,
        buy([
          { ticketTypeId: lotA, quantity: 1 },
          { ticketTypeId: lotB, quantity: 1 },
        ]),
        options,
      ),
    ).rejects.toThrow(SalesWindowClosedError);
    expect(db.reservations).toEqual([]);
  });

  it.each([
    ['lote inexistente', () => setup(), TicketTypeNotFoundError],
    [
      'evento cancelado',
      () => {
        const db = setup();
        db.addTicketType(lotA, { status: 'CANCELLED' });
        return db;
      },
      EventNotPublishedError,
    ],
    [
      'total acima do limite',
      () => {
        const db = setup();
        db.addTicketType(lotA, { priceCents: 99_999_999 });
        return db;
      },
      OrderTotalTooLargeError,
    ],
  ] as const)('recusa %s sem reservar', async (_case, makeDb, error) => {
    const db = makeDb();
    const ticketTypeId = _case === 'lote inexistente' ? 'lote-que-nao-existe' : lotA;
    await expect(placeOrder(db, buy([{ ticketTypeId, quantity: 2 }]), options)).rejects.toThrow(
      error,
    );
    expect(db.reservations).toEqual([]);
    expect(db.orders).toEqual([]);
  });

  it('se faltar estoque em um lote, nenhum fica reservado', async () => {
    const db = setup();
    db.addTicketType(lotB, { available: 0 });

    await expect(
      placeOrder(
        db,
        buy([
          { ticketTypeId: lotA, quantity: 2 },
          { ticketTypeId: lotB, quantity: 1 },
        ]),
        options,
      ),
    ).rejects.toThrow(new InsufficientStockError(lotB));
    expect(db.available(lotA)).toBe(10);
    expect(db.orders).toEqual([]);
    expect(db.runs).toBe(1);
  });

  it('recusa lote repetido (a borda da API já recusa antes)', async () => {
    const db = setup();
    await expect(
      placeOrder(
        db,
        buy([
          { ticketTypeId: lotA, quantity: 1 },
          { ticketTypeId: lotA, quantity: 1 },
        ]),
        options,
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('Idempotency-Key', () => {
  const key = { key: 'tentativa-1', requestHash: 'hash-do-corpo' };
  const items = [{ ticketTypeId: lotA, quantity: 2 }];

  it('grava a chave e o hash no pedido', async () => {
    const db = setup();
    const { order } = await placeOrder(db, buy(items, key), options);
    expect(order).toMatchObject({ idempotencyKey: 'tentativa-1', requestHash: 'hash-do-corpo' });
  });

  it('mesma chave e mesmo corpo devolvem o pedido existente sem reservar de novo', async () => {
    const db = setup();
    const first = await placeOrder(db, buy(items, key), options);
    const second = await placeOrder(db, buy(items, key), options);

    expect(second).toEqual({ order: first.order, replayed: true });
    expect(db.orders).toHaveLength(1);
    expect(db.available(lotA)).toBe(8);
  });

  it('mesma chave com outro corpo é recusada', async () => {
    const db = setup();
    await placeOrder(db, buy(items, key), options);
    await expect(
      placeOrder(db, buy(items, { key: 'tentativa-1', requestHash: 'outro-hash' }), options),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('a chave vale por usuário', async () => {
    const db = setup();
    await placeOrder(db, buy(items, key), options);
    const other = await placeOrder(db, { ...buy(items, key), userId: 'comprador-2' }, options);
    expect(other.replayed).toBe(false);
    expect(db.orders).toHaveLength(2);
  });

  describe('outra requisição com a mesma chave grava primeiro', () => {
    function racingDatabase(competitorHash: string) {
      const db = setup();
      db.beforeCreate = (newOrder) => {
        db.committedElsewhere.push(
          db.toOrder({ ...newOrder, requestHash: competitorHash }, 'pedido-rival'),
        );
      };
      return db;
    }

    it('a nova tentativa devolve o pedido da outra requisição', async () => {
      const db = racingDatabase('hash-do-corpo');
      const result = await placeOrder(db, buy(items, key), options);

      expect(result.replayed).toBe(true);
      expect(result.order.id).toBe('pedido-rival');
      expect(db.runs).toBe(2);
      // A reserva da primeira tentativa foi desfeita junto com a transação.
      expect(db.available(lotA)).toBe(10);
    });

    it('com corpo diferente, a nova tentativa recusa', async () => {
      const db = racingDatabase('outro-hash');
      await expect(placeOrder(db, buy(items, key), options)).rejects.toThrow(
        IdempotencyConflictError,
      );
    });

    it('se a outra levou o último ingresso, devolve o pedido dela em vez de recusar', async () => {
      const db = setup();
      db.beforeReserve = () => {
        db.committedElsewhere.push(
          db.toOrder(
            {
              userId: 'comprador-1',
              items: [{ ticketTypeId: lotA, quantity: 2, unitPriceCents: 8_000 }],
              totalCents: 16_000,
              expiresAt: new Date('2026-11-20T12:30:00Z'),
              idempotencyKey: key.key,
              requestHash: key.requestHash,
            },
            'pedido-rival',
          ),
        );
        db.addTicketType(lotA, { available: 0 });
      };

      const result = await placeOrder(db, buy(items, key), options);
      expect(result).toMatchObject({ replayed: true, order: { id: 'pedido-rival' } });
    });
  });

  it('sem pedido com a chave, o erro original segue', async () => {
    const db = setup();
    db.addTicketType(lotA, { available: 1 });
    await expect(placeOrder(db, buy(items, key), options)).rejects.toThrow(InsufficientStockError);
    // A transação da compra e a consulta da chave.
    expect(db.runs).toBe(2);
  });

  it('erro de infraestrutura não dispara a consulta da chave', async () => {
    const db = setup();
    db.beforeReserve = () => {
      throw new Error('conexão perdida');
    };
    await expect(placeOrder(db, buy(items, key), options)).rejects.toThrow('conexão perdida');
    expect(db.runs).toBe(1);
  });
});
