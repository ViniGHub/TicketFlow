import { REFUND_ORDER_JOB, SEND_EVENT_CANCELLED_EMAIL_JOB } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { cancelEvent, EventNotCancellableError } from './cancel-event.js';
import { EventNotFoundError } from './catalog.js';
import { FAKE_NOW, FakeDatabase } from './fake-database.test-helper.js';
import { type Order } from './order.js';

const EVENT_ID = 'evento-1';
const OTHER_EVENT_ID = 'evento-2';
const ORGANIZER_ID = 'organizador-1';
const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const lotB = '0193a4f2-0000-7000-8000-00000000000b';
const lotOther = '0193a4f2-0000-7000-8000-0000000000c1';
const NOW = FAKE_NOW;
const LATER = new Date(NOW.getTime() + 10 * 60_000);

/** Dois lotes do evento 1 e um do evento 2, com 5 ingressos disponíveis em cada. */
function setup() {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: 5 });
  db.addTicketType(lotB, { available: 5 });
  db.addTicketType(lotOther, { available: 5, eventId: OTHER_EVENT_ID });
  db.addEvent(EVENT_ID, { organizerId: ORGANIZER_ID });
  db.addEvent(OTHER_EVENT_ID, { organizerId: ORGANIZER_ID });
  const cancel = (organizerId = ORGANIZER_ID, eventId = EVENT_ID) =>
    cancelEvent(db, { eventId, organizerId, now: NOW });
  return { db, cancel };
}

/** Pedido de 2 ingressos do lote A (ou do lote informado). */
function order(db: FakeDatabase, id: string, overrides: Partial<Order> = {}, ticketTypeId = lotA) {
  return db.addOrder(id, {
    status: 'PAID',
    totalCents: 16_000,
    stripeSessionId: `cs_${id}`,
    stripePaymentIntentId: `pi_${id}`,
    expiresAt: LATER,
    items: [{ ticketTypeId, quantity: 2, unitPriceCents: 8_000 }],
    ...overrides,
  });
}

describe('cancelEvent', () => {
  it('pedido pago: REFUND_PENDING, ingressos anulados, refund-order e e-mail na outbox', async () => {
    const { db, cancel } = setup();
    order(db, 'pago');

    const result = await cancel();

    expect(result).toMatchObject({ outcome: 'cancelled', refunding: ['pago'], refunded: [] });
    expect(db.order('pago')?.status).toBe('REFUND_PENDING');
    expect(db.ticketVoids).toEqual([{ orderId: 'pago', voidedAt: NOW }]);
    expect(db.outbox).toEqual([
      { type: REFUND_ORDER_JOB, payload: { orderId: 'pago' } },
      { type: SEND_EVENT_CANCELLED_EMAIL_JOB, payload: { orderId: 'pago' } },
    ]);
    // Reembolso não devolve estoque (seção 4): o evento cancelado não vende mais.
    expect(db.releases).toEqual([]);
  });

  it('três pedidos pagos geram três reembolsos, um por pedido', async () => {
    const { db, cancel } = setup();
    order(db, 'pago-1');
    order(db, 'pago-2');
    order(db, 'pago-3', {}, lotB);

    const result = await cancel();

    expect(result.refunding).toEqual(['pago-1', 'pago-2', 'pago-3']);
    const refunds = db.outbox.filter((message) => message.type === REFUND_ORDER_JOB);
    expect(refunds.map((message) => message.payload)).toEqual([
      { orderId: 'pago-1' },
      { orderId: 'pago-2' },
      { orderId: 'pago-3' },
    ]);
  });

  it('pedido grátis pago não tem o que devolver: REFUNDED na hora, só o e-mail', async () => {
    const { db, cancel } = setup();
    order(db, 'gratis', { totalCents: 0, stripePaymentIntentId: null });

    const result = await cancel();

    expect(result).toMatchObject({ refunding: [], refunded: ['gratis'] });
    expect(db.order('gratis')?.status).toBe('REFUNDED');
    expect(db.ticketVoids).toEqual([{ orderId: 'gratis', voidedAt: NOW }]);
    expect(db.outbox).toEqual([
      { type: SEND_EVENT_CANCELLED_EMAIL_JOB, payload: { orderId: 'gratis' } },
    ]);
  });

  it('pedido pendente: a reserva acaba agora, e o estoque só volta pelo job de expiração', async () => {
    const { db, cancel } = setup();
    order(db, 'pendente', { status: 'PENDING', stripePaymentIntentId: null });

    const result = await cancel();

    expect(result.reservationsEnded).toEqual(['pendente']);
    expect(db.order('pendente')).toMatchObject({ status: 'PENDING', expiresAt: NOW });
    expect(db.releases).toEqual([]);
    expect(db.outbox).toEqual([]);
  });

  it('reserva que já tinha vencido mantém o vencimento original', async () => {
    const { db, cancel } = setup();
    const earlier = new Date(NOW.getTime() - 60_000);
    order(db, 'vencido', { status: 'PENDING', stripePaymentIntentId: null, expiresAt: earlier });

    await cancel();

    expect(db.order('vencido')?.expiresAt).toEqual(earlier);
  });

  it('pagamento assíncrono em curso (PROCESSING) espera o Stripe', async () => {
    const { db, cancel } = setup();
    order(db, 'pix', { status: 'PROCESSING' });

    const result = await cancel();

    expect(result.awaitingPayment).toEqual(['pix']);
    expect(db.order('pix')).toMatchObject({ status: 'PROCESSING', expiresAt: LATER });
    expect(db.outbox).toEqual([]);
  });

  it('pedidos encerrados e pedidos de outros eventos ficam como estão', async () => {
    const { db, cancel } = setup();
    order(db, 'expirado', { status: 'EXPIRED' });
    order(db, 'cancelado', { status: 'CANCELLED' });
    order(db, 'reembolsado', { status: 'REFUNDED' });
    order(db, 'outro-evento', {}, lotOther);

    const result = await cancel();

    expect(result).toEqual({
      outcome: 'cancelled',
      refunding: [],
      refunded: [],
      reservationsEnded: [],
      awaitingPayment: [],
    });
    expect(db.order('outro-evento')?.status).toBe('PAID');
    expect(db.outbox).toEqual([]);
  });

  it('pedido com ingressos de dois eventos é reembolsado inteiro', async () => {
    const { db, cancel } = setup();
    order(db, 'misto', {
      items: [
        { ticketTypeId: lotA, quantity: 1, unitPriceCents: 8_000 },
        { ticketTypeId: lotOther, quantity: 1, unitPriceCents: 8_000 },
      ],
    });

    await cancel();

    expect(db.order('misto')?.status).toBe('REFUND_PENDING');
    expect(db.ticketVoids).toEqual([{ orderId: 'misto', voidedAt: NOW }]);
  });

  it('marca o evento como cancelado, e os lotes dele deixam de vender', async () => {
    const { db, cancel } = setup();

    await cancel();

    expect(db.events.get(EVENT_ID)).toMatchObject({ status: 'CANCELLED', cancelledAt: NOW });
    expect(db.ticketTypes.get(lotA)?.event.status).toBe('CANCELLED');
    expect(db.ticketTypes.get(lotOther)?.event.status).toBe('PUBLISHED');
  });

  it('trava o evento antes dos pedidos, e os pedidos em ordem de id, numa transação', async () => {
    const { db, cancel } = setup();
    order(db, 'pedido-b');
    order(db, 'pedido-a', { status: 'PENDING', stripePaymentIntentId: null });

    await cancel();

    expect(db.locks).toEqual([EVENT_ID, 'pedido-a', 'pedido-b']);
    expect(db.runs).toBe(1);
  });

  it('evento de outro organizador ou inexistente: EVENT_NOT_FOUND, nada muda', async () => {
    const { db, cancel } = setup();
    order(db, 'pago');

    await expect(cancel('outro-organizador')).rejects.toBeInstanceOf(EventNotFoundError);
    await expect(cancel(ORGANIZER_ID, 'nao-existe')).rejects.toBeInstanceOf(EventNotFoundError);
    expect(db.events.get(EVENT_ID)?.status).toBe('PUBLISHED');
    expect(db.order('pago')?.status).toBe('PAID');
  });

  it('rascunho não se cancela: EVENT_NOT_CANCELLABLE', async () => {
    const { db, cancel } = setup();
    db.addEvent(EVENT_ID, { organizerId: ORGANIZER_ID, status: 'DRAFT' });

    await expect(cancel()).rejects.toBeInstanceOf(EventNotCancellableError);
  });

  it('evento já cancelado: nada muda, e o resultado diz isso', async () => {
    const { db, cancel } = setup();
    order(db, 'pago');
    await cancel();
    const outboxBefore = db.outbox.length;

    const again = await cancel();

    expect(again.outcome).toBe('already-cancelled');
    expect(db.outbox).toHaveLength(outboxBefore);
  });

  it('falha no meio desfaz tudo, inclusive o status do evento', async () => {
    const { db, cancel } = setup();
    order(db, 'pago');
    db.beforeOutboxAdd = (message) => {
      if (message.type === SEND_EVENT_CANCELLED_EMAIL_JOB) {
        throw new Error('falha no meio');
      }
    };

    await expect(cancel()).rejects.toThrow('falha no meio');

    expect(db.events.get(EVENT_ID)?.status).toBe('PUBLISHED');
    expect(db.ticketTypes.get(lotA)?.event.status).toBe('PUBLISHED');
    expect(db.order('pago')?.status).toBe('PAID');
    expect(db.outbox).toEqual([]);
    expect(db.ticketVoids).toEqual([]);
  });
});
