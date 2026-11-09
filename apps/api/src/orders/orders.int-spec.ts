import {
  type CreateOrderResponse,
  type ErrorResponse,
  type OrderResponse,
} from '@ticketflow/contracts';
import { createPrismaClient } from '@ticketflow/db';
import { ExpirationService } from '@ticketflow/domain';
import { flushRedis, truncateAllTables } from '@ticketflow/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { call, type CookieJar, sessionFor, startTestApp, type TestApp } from '../../test/app';
import { DAY_MS, fixtures, fromNow, HOUR_MS } from '../../test/fixtures';

import { PrismaUnitOfWork } from '@ticketflow/persistence';

const databaseUrl = inject('databaseUrl');
const redisUrl = inject('redisUrl');
const prisma = createPrismaClient(databaseUrl);
const { createUser, createBuyer, createEvent, createLot, createOrder, availableOf } =
  fixtures(prisma);

const RESERVATION_TTL_MS = 30 * 60 * 1000; // RESERVATION_TTL_MINUTES padrão

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp();
});

afterAll(async () => {
  await api.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
  // Zera o rate limit de POST /orders entre os testes.
  await flushRedis(redisUrl);
  api.payments.reset();
});

interface Item {
  ticketTypeId: string;
  quantity: number;
}

function postOrder(
  jar: CookieJar | undefined,
  body: { items: Item[] },
  idempotencyKey?: string,
): Promise<Response> {
  return call(api.url, '/orders', {
    method: 'POST',
    body,
    ...(jar && { jar }),
    ...(idempotencyKey !== undefined && { headers: { 'Idempotency-Key': idempotencyKey } }),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function errorOf(response: Response): Promise<ErrorResponse> {
  return json<ErrorResponse>(response);
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);

describe('POST /orders', () => {
  it('cria o pedido PENDING, reserva o estoque e copia o preço do lote', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const pista = await createLot(event.id, { priceCents: 8_000, total: 10 });
    const meia = await createLot(event.id, { priceCents: 4_000, total: 5 });

    const before = Date.now();
    const response = await postOrder(buyer.jar, {
      items: [
        { ticketTypeId: meia.id, quantity: 1 },
        { ticketTypeId: pista.id, quantity: 2 },
      ],
    });
    const after = Date.now();

    expect(response.status).toBe(201);
    expect(response.headers.get('idempotent-replayed')).toBeNull();
    const order = await json<OrderResponse>(response);
    expect(order).toMatchObject({ status: 'PENDING', totalCents: 20_000, currency: 'BRL' });
    // Itens em ordem de lote, a mesma da reserva.
    expect(order.items).toEqual(
      [
        { id: pista.id, ticketTypeId: pista.id, quantity: 2, unitPriceCents: 8_000 },
        { id: meia.id, ticketTypeId: meia.id, quantity: 1, unitPriceCents: 4_000 },
      ]
        .sort(byId)
        .map(({ ticketTypeId, quantity, unitPriceCents }) => ({
          ticketTypeId,
          quantity,
          unitPriceCents,
        })),
    );
    const expiresAt = new Date(order.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + RESERVATION_TTL_MS - 1_000);
    expect(expiresAt).toBeLessThanOrEqual(after + RESERVATION_TTL_MS + 1_000);

    expect(await availableOf(pista.id)).toBe(8);
    expect(await availableOf(meia.id)).toBe(4);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(stored).toMatchObject({ userId: buyer.id, idempotencyKey: null, requestHash: null });
    expect(stored.items).toHaveLength(2);

    // O preço do pedido não acompanha mudanças posteriores no lote.
    await prisma.ticketType.update({ where: { id: pista.id }, data: { priceCents: 9_999 } });
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id, ticketTypeId: pista.id },
    });
    expect(item.unitPriceCents).toBe(8_000);
  });

  it('depois do commit, cria a Checkout Session com a chave do pedido e devolve a URL', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { priceCents: 8_000, total: 10 });

    const response = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 2 }] });

    expect(response.status).toBe(201);
    const order = await json<CreateOrderResponse>(response);
    expect(api.payments.createCalls).toEqual([
      {
        idempotencyKey: order.id,
        request: {
          orderId: order.id,
          lineItems: [{ name: 'Show de Teste – Pista', quantity: 2, unitPriceCents: 8_000 }],
          expiresAt: new Date(order.expiresAt),
          orderCreatedAt: new Date(order.createdAt),
        },
      },
    ]);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.stripeSessionId).toMatch(/^cs_test_fake_/);
    expect(order.checkoutUrl).toBe(`https://checkout.stripe.test/c/pay/${stored.stripeSessionId}`);
    expect(order.status).toBe('PENDING');
  });

  it('falha do Stripe: 503, pedido CANCELLED e o estoque de volta ao valor original', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const body = { items: [{ ticketTypeId: lot.id, quantity: 3 }] };
    api.payments.failNextCreate();

    const response = await postOrder(buyer.jar, body, 'compra-1');

    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('CHECKOUT_UNAVAILABLE');
    expect(await availableOf(lot.id)).toBe(10);
    const stored = await prisma.order.findFirstOrThrow();
    expect(stored).toMatchObject({ status: 'CANCELLED', stripeSessionId: null });

    // A mesma chave depois da compensação devolve o pedido cancelado: nada é reservado de
    // novo e nenhuma sessão é criada. Outra compra precisa de outra chave.
    const retry = await postOrder(buyer.jar, body, 'compra-1');
    expect(retry.status).toBe(201);
    expect(await json<CreateOrderResponse>(retry)).toMatchObject({
      id: stored.id,
      status: 'CANCELLED',
      checkoutUrl: null,
    });
    expect(api.payments.createCalls).toHaveLength(1);
    expect(await availableOf(lot.id)).toBe(10);
  });

  it('total pago abaixo do mínimo do Stripe (R$ 0,50) responde 422 sem reservar', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { priceCents: 10, total: 10 });

    const response = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 2 }] });

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('ORDER_TOTAL_TOO_SMALL');
    expect(await availableOf(lot.id)).toBe(10);
    expect(api.payments.createCalls).toEqual([]);
  });

  it('50 compradores disputando 10 ingressos: exatamente 10 pedidos, em 10 rodadas seguidas', async () => {
    const buyers = await Promise.all(Array.from({ length: 50 }, () => createBuyer()));
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10, maxPerOrder: 1 });

    for (let round = 1; round <= 10; round += 1) {
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.ticketType.update({ where: { id: lot.id }, data: { available: 10 } });
      await flushRedis(redisUrl);

      const responses = await Promise.all(
        buyers.map(({ jar }) => postOrder(jar, { items: [{ ticketTypeId: lot.id, quantity: 1 }] })),
      );
      const outcomes = await Promise.all(
        responses.map(async (response) => {
          const body = await json<{ code?: string }>(response);
          return response.status === 201 ? 'criado' : `${response.status} ${body.code}`;
        }),
      );
      const tally = outcomes.reduce<Record<string, number>>(
        (counts, outcome) => ({ ...counts, [outcome]: (counts[outcome] ?? 0) + 1 }),
        {},
      );

      expect({ round, tally }).toEqual({
        round,
        tally: { criado: 10, '409 INSUFFICIENT_STOCK': 40 },
      });
      expect(await availableOf(lot.id)).toBe(0);
      const orders = await prisma.order.findMany({ select: { userId: true } });
      expect(orders).toHaveLength(10);
      expect(new Set(orders.map((order) => order.userId)).size).toBe(10);
    }
  }, 120_000);

  it('pedido com vários lotes falha inteiro se um deles não tem estoque', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    // O lote com estoque tem o menor id: é reservado primeiro e precisa voltar no rollback.
    const [withStock, soldOut] = [
      await createLot(event.id, { total: 10 }),
      await createLot(event.id, { total: 5 }),
    ].sort(byId);
    if (!withStock || !soldOut) {
      throw new Error('lotes não criados');
    }
    await prisma.ticketType.update({ where: { id: soldOut.id }, data: { available: 0 } });

    const response = await postOrder(buyer.jar, {
      items: [
        { ticketTypeId: soldOut.id, quantity: 1 },
        { ticketTypeId: withStock.id, quantity: 2 },
      ],
    });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('INSUFFICIENT_STOCK');
    expect(await availableOf(withStock.id)).toBe(withStock.total);
    expect(await prisma.order.count()).toBe(0);
  });

  it.each([
    ['antes do início das vendas', { salesStart: fromNow(HOUR_MS), salesEnd: fromNow(DAY_MS) }],
    ['depois do fim das vendas', { salesStart: fromNow(-2 * DAY_MS), salesEnd: fromNow(-HOUR_MS) }],
  ])('%s responde 409 sem reservar', async (_case, window) => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10, ...window });

    const response = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 1 }] });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('SALES_WINDOW_CLOSED');
    expect(await availableOf(lot.id)).toBe(10);
    expect(await prisma.order.count()).toBe(0);
  });

  it('acima de max_per_order responde 422 sem reservar', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10, maxPerOrder: 2 });

    const response = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 3 }] });

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('MAX_PER_ORDER_EXCEEDED');
    expect(await availableOf(lot.id)).toBe(10);
    expect(await prisma.order.count()).toBe(0);
  });

  it.each(['DRAFT', 'CANCELLED'] as const)('evento %s responde 409', async (status) => {
    const buyer = await createBuyer();
    const event = await createEvent(status);
    const lot = await createLot(event.id);

    const response = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 1 }] });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('EVENT_NOT_PUBLISHED');
    expect(await availableOf(lot.id)).toBe(10);
  });

  it('lote inexistente responde 404', async () => {
    const buyer = await createBuyer();
    const response = await postOrder(buyer.jar, {
      items: [{ ticketTypeId: '0193a4f2-0000-7000-8000-000000000000', quantity: 1 }],
    });
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe('TICKET_TYPE_NOT_FOUND');
  });
});

describe('Idempotency-Key', () => {
  it('a mesma chave com o mesmo corpo devolve o mesmo pedido e reserva uma vez só', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const body = { items: [{ ticketTypeId: lot.id, quantity: 2 }] };

    const first = await postOrder(buyer.jar, body, 'compra-1');
    const second = await postOrder(buyer.jar, body, 'compra-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect((await json<OrderResponse>(second)).id).toBe((await json<OrderResponse>(first)).id);
    expect(await prisma.order.count()).toBe(1);
    expect(await availableOf(lot.id)).toBe(8);
    const stored = await prisma.order.findFirstOrThrow();
    expect(stored.idempotencyKey).toBe('compra-1');
    expect(stored.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a mesma chave com outro corpo responde 422', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });

    await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 2 }] }, 'compra-1');
    const response = await postOrder(
      buyer.jar,
      { items: [{ ticketTypeId: lot.id, quantity: 3 }] },
      'compra-1',
    );

    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.order.count()).toBe(1);
    expect(await availableOf(lot.id)).toBe(8);
  });

  // Com 1 ingresso, a requisição que perde a corrida falha por falta de estoque; com 10, ela
  // reserva e esbarra no UNIQUE da chave (P2002). Nos dois casos devolve o pedido da outra.
  it.each([
    ['disputando o último ingresso', 1],
    ['com estoque sobrando', 10],
  ])('requisições simultâneas com a mesma chave criam um pedido só (%s)', async (_case, total) => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total });
    const body = { items: [{ ticketTypeId: lot.id, quantity: 1 }] };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postOrder(buyer.jar, body, 'compra-unica')),
    );

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    const bodies = await Promise.all(
      responses.map((response) => json<CreateOrderResponse>(response)),
    );
    const ids = bodies.map((body) => body.id);
    expect(new Set(ids).size).toBe(1);
    expect(responses.filter((r) => r.headers.get('idempotent-replayed') === 'true')).toHaveLength(
      4,
    );
    expect(await prisma.order.count()).toBe(1);
    expect(await availableOf(lot.id)).toBe(total - 1);
    // Quem chegou antes de a sessão ser gravada tentou criá-la de novo, com a mesma chave: o
    // Stripe devolve a mesma sessão, e todos recebem a mesma URL.
    const [orderId] = ids;
    expect(new Set(api.payments.createCalls.map((call) => call.idempotencyKey))).toEqual(
      new Set([orderId]),
    );
    expect(api.payments.sessionCount).toBe(1);
    const urls = bodies.map((body) => body.checkoutUrl);
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });

  it('retentativa de pedido sem sessão (o processo caiu) usa a mesma chave no Stripe', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { priceCents: 8_000, total: 10 });
    const items = [{ ticketTypeId: lot.id, quantity: 2 }];
    // O processo caiu logo depois de o Stripe criar a sessão, antes de gravá-la: o pedido
    // ficou PENDING sem stripe_session_id.
    const order = await createOrder(buyer.id, items, 'compra-1');
    const lost = await api.payments.createCheckoutSession({
      orderId: order.id,
      lineItems: [{ name: 'Show de Teste – Pista', quantity: 2, unitPriceCents: 8_000 }],
      expiresAt: order.expiresAt,
      orderCreatedAt: order.createdAt,
    });

    const retry = await postOrder(buyer.jar, { items }, 'compra-1');

    expect(retry.status).toBe(201);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    const replayed = await json<CreateOrderResponse>(retry);
    expect(replayed).toMatchObject({ id: order.id, status: 'PENDING', checkoutUrl: lost.url });
    // Mesma chave e mesmos parâmetros: o Stripe devolve a sessão que já existia.
    expect(api.payments.createCalls.map((call) => call.idempotencyKey)).toEqual([
      order.id,
      order.id,
    ]);
    expect(api.payments.sessionCount).toBe(1);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.stripeSessionId).toBe(lost.id);

    // Com a sessão gravada, a próxima retentativa só busca a URL.
    const again = await postOrder(buyer.jar, { items }, 'compra-1');
    expect((await json<CreateOrderResponse>(again)).checkoutUrl).toBe(lost.url);
    expect(api.payments.createCalls).toHaveLength(2);
    expect(api.payments.retrieveCalls).toEqual([lost.id]);
    expect(await availableOf(lot.id)).toBe(8);
  });

  it('a chave vale por comprador', async () => {
    const [ana, bia] = [await createBuyer(), await createBuyer()];
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const body = { items: [{ ticketTypeId: lot.id, quantity: 1 }] };

    const fromAna = await json<OrderResponse>(await postOrder(ana.jar, body, 'mesma-chave'));
    const fromBia = await json<OrderResponse>(await postOrder(bia.jar, body, 'mesma-chave'));

    expect(fromAna.id).not.toBe(fromBia.id);
    expect(await availableOf(lot.id)).toBe(8);
  });

  it('chave inválida responde 400 apontando o header', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id);

    const response = await postOrder(
      buyer.jar,
      { items: [{ ticketTypeId: lot.id, quantity: 1 }] },
      'chave com espaço',
    );

    expect(response.status).toBe(400);
    expect((await errorOf(response)).issues?.[0]?.path).toBe('Idempotency-Key');
    expect(await availableOf(lot.id)).toBe(10);
  });
});

describe('GET /orders/:id', () => {
  function getOrder(jar: CookieJar | undefined, orderId: string): Promise<Response> {
    return call(api.url, `/orders/${orderId}`, { ...(jar && { jar }) });
  }

  it('o dono vê o pedido; outro comprador recebe 404, como se ele não existisse', async () => {
    const [owner, intruder] = [await createBuyer(), await createBuyer()];
    const event = await createEvent();
    const lot = await createLot(event.id, { priceCents: 8_000, total: 10 });
    const order = await createOrder(owner.id, [{ ticketTypeId: lot.id, quantity: 1 }]);

    const own = await getOrder(owner.jar, order.id);
    expect(own.status).toBe(200);
    expect(await json<OrderResponse>(own)).toMatchObject({
      id: order.id,
      status: 'PENDING',
      totalCents: 8_000,
    });

    const fromIntruder = await getOrder(intruder.jar, order.id);
    expect(fromIntruder.status).toBe(404);
    expect((await errorOf(fromIntruder)).code).toBe('ORDER_NOT_FOUND');
    const missing = await getOrder(owner.jar, '0193a4f2-0000-7000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).code).toBe('ORDER_NOT_FOUND');
    expect((await getOrder(owner.jar, 'nao-e-uuid')).status).toBe(400);
  });

  it('mostra o status gravado, sem consultar o Stripe', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id);
    const order = await createOrder(buyer.id, [{ ticketTypeId: lot.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });

    const response = await getOrder(buyer.jar, order.id);

    expect((await json<OrderResponse>(response)).status).toBe('PAID');
    expect(api.payments.retrieveCalls).toEqual([]);
  });

  it('o polling da página de sucesso não conta no limite de 20 pedidos por minuto', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id);
    const order = await createOrder(buyer.id, [{ ticketTypeId: lot.id, quantity: 1 }]);

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const response = await getOrder(buyer.jar, order.id);
      expect({ attempt, status: response.status }).toEqual({ attempt, status: 200 });
      await response.json();
    }
    const created = await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 1 }] });
    expect(created.status).toBe(201);
  });

  it('sem sessão responde 401', async () => {
    const response = await getOrder(undefined, '0193a4f2-0000-7000-8000-000000000000');
    expect(response.status).toBe(401);
  });
});

describe('POST /orders/:id/cancel', () => {
  function cancelRequest(jar: CookieJar | undefined, orderId: string): Promise<Response> {
    return call(api.url, `/orders/${orderId}/cancel`, { method: 'POST', ...(jar && { jar }) });
  }

  it('o dono cancela um pedido PENDING e o estoque volta ao valor original', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const created = await json<OrderResponse>(
      await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 3 }] }),
    );
    expect(await availableOf(lot.id)).toBe(7);

    const response = await cancelRequest(buyer.jar, created.id);

    expect(response.status).toBe(200);
    expect(await json<OrderResponse>(response)).toMatchObject({
      id: created.id,
      status: 'CANCELLED',
    });
    expect(await availableOf(lot.id)).toBe(10);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe('CANCELLED');
    // A sessão expira no Stripe antes de o estoque voltar: não pode mais ser paga.
    const sessionId = stored.stripeSessionId ?? '';
    expect(api.payments.expireCalls).toEqual([sessionId]);
    expect(api.payments.session(sessionId)).toMatchObject({ status: 'expired', url: null });
  });

  it('sessão já paga: 409 ORDER_PAYMENT_COMPLETED e o estoque continua reservado', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const created = await json<CreateOrderResponse>(
      await postOrder(buyer.jar, { items: [{ ticketTypeId: lot.id, quantity: 2 }] }),
    );
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    api.payments.complete(stored.stripeSessionId ?? '');

    const response = await cancelRequest(buyer.jar, created.id);

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('ORDER_PAYMENT_COMPLETED');
    expect(await availableOf(lot.id)).toBe(8);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe('PENDING');
  });

  it('cancelar duas vezes: a segunda responde 409 e o estoque volta uma vez só', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const order = await createOrder(buyer.id, [{ ticketTypeId: lot.id, quantity: 2 }]);

    expect((await cancelRequest(buyer.jar, order.id)).status).toBe(200);
    const again = await cancelRequest(buyer.jar, order.id);

    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('ORDER_NOT_CANCELLABLE');
    expect(await availableOf(lot.id)).toBe(10);
  });

  it.each(['EXPIRED', 'PAID'] as const)(
    'pedido %s responde 409 sem mexer no estoque',
    async (status) => {
      const buyer = await createBuyer();
      const event = await createEvent();
      const lot = await createLot(event.id, { total: 10 });
      const order = await createOrder(buyer.id, [{ ticketTypeId: lot.id, quantity: 2 }]);
      await prisma.order.update({ where: { id: order.id }, data: { status } });

      const response = await cancelRequest(buyer.jar, order.id);

      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('ORDER_NOT_CANCELLABLE');
      expect(await availableOf(lot.id)).toBe(8);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(stored.status).toBe(status);
    },
  );

  it('pedido de outro comprador ou inexistente responde 404; id inválido, 400', async () => {
    const [owner, intruder] = [await createBuyer(), await createBuyer()];
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const order = await createOrder(owner.id, [{ ticketTypeId: lot.id, quantity: 1 }]);

    const fromIntruder = await cancelRequest(intruder.jar, order.id);
    expect(fromIntruder.status).toBe(404);
    expect((await errorOf(fromIntruder)).code).toBe('ORDER_NOT_FOUND');
    expect((await cancelRequest(owner.jar, '0193a4f2-0000-7000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await cancelRequest(owner.jar, 'nao-e-uuid')).status).toBe(400);
    expect(await availableOf(lot.id)).toBe(9);
  });

  it('sem sessão responde 401', async () => {
    const response = await cancelRequest(undefined, '0193a4f2-0000-7000-8000-000000000000');
    expect(response.status).toBe(401);
  });

  it('cancelamento e expiração simultâneos devolvem o estoque uma vez só', async () => {
    const buyer = await createBuyer();
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 10 });
    const order = await createOrder(buyer.id, [{ ticketTypeId: lot.id, quantity: 2 }]);
    await prisma.order.update({ where: { id: order.id }, data: { expiresAt: fromNow(-60_000) } });
    const expiration = new ExpirationService(new PrismaUnitOfWork(prisma), api.payments);

    const [response, summary] = await Promise.all([
      cancelRequest(buyer.jar, order.id),
      expiration.expireDue(new Date()),
    ]);

    expect(await availableOf(lot.id)).toBe(10);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (response.status === 200) {
      expect(stored.status).toBe('CANCELLED');
      expect(summary.expired).toEqual([]);
    } else {
      expect(response.status).toBe(409);
      expect(stored.status).toBe('EXPIRED');
      expect(summary.expired).toEqual([order.id]);
    }
  });
});

describe('acesso e entrada', () => {
  const someLot = '0193a4f2-0000-7000-8000-000000000001';

  it('sem sessão responde 401', async () => {
    const response = await postOrder(undefined, {
      items: [{ ticketTypeId: someLot, quantity: 1 }],
    });
    expect(response.status).toBe(401);
  });

  it('usuário só organizador responde 403', async () => {
    const organizer = await createUser(['ORGANIZER']);
    const jar = await sessionFor(organizer, ['ORGANIZER']);
    const response = await postOrder(jar, { items: [{ ticketTypeId: someLot, quantity: 1 }] });
    expect(response.status).toBe(403);
  });

  it.each([
    ['sem itens', []],
    [
      'lote repetido',
      [
        { ticketTypeId: someLot, quantity: 1 },
        { ticketTypeId: someLot, quantity: 1 },
      ],
    ],
    ['quantidade zero', [{ ticketTypeId: someLot, quantity: 0 }]],
  ])('entrada inválida (%s) responde 400', async (_case, items) => {
    const buyer = await createBuyer();
    const response = await postOrder(buyer.jar, { items });
    expect(response.status).toBe(400);
  });

  it('a 21ª requisição do mesmo comprador no minuto responde 429; outro comprador segue', async () => {
    const [ana, bia] = [await createBuyer(), await createBuyer()];
    const event = await createEvent();
    const lot = await createLot(event.id, { total: 100, maxPerOrder: 1 });
    const body = { items: [{ ticketTypeId: lot.id, quantity: 1 }] };

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await postOrder(ana.jar, body);
      expect({ attempt, status: response.status }).toEqual({ attempt, status: 201 });
      await response.json();
    }
    const blocked = await postOrder(ana.jar, body);
    expect(blocked.status).toBe(429);
    expect((await postOrder(bia.jar, body)).status).toBe(201);
  });
});
