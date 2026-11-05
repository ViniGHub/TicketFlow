import { describe, expect, it } from 'vitest';

import { ExpirationService } from './expiration.js';
import { FAKE_NOW, FakeDatabase, FakeSessionExpirer } from './fake-database.test-helper.js';
import { type Order } from './order.js';

const lotA = '0193a4f2-0000-7000-8000-00000000000a';
const MINUTE_MS = 60_000;
const ago = (minutes: number) => new Date(FAKE_NOW.getTime() - minutes * MINUTE_MS);

function setup() {
  const db = new FakeDatabase();
  db.addTicketType(lotA, { available: 0 });
  const expirer = new FakeSessionExpirer();
  return { db, expirer, service: new ExpirationService(db, expirer) };
}

/** Pedido de 1 ingresso do lote A; o estoque do lote já está descontado. */
function addOrder(db: FakeDatabase, id: string, overrides: Partial<Order> = {}): void {
  db.addOrder(id, {
    status: 'PENDING',
    expiresAt: ago(1),
    items: [{ ticketTypeId: lotA, quantity: 1, unitPriceCents: 8_000 }],
    ...overrides,
  });
}

describe('expiração de pedidos', () => {
  it('expira os PENDING vencidos e devolve o estoque', async () => {
    const { db, service } = setup();
    addOrder(db, 'vencido-1');
    addOrder(db, 'vencido-2', { expiresAt: ago(5) });

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.expired.sort()).toEqual(['vencido-1', 'vencido-2']);
    expect(db.order('vencido-1')?.status).toBe('EXPIRED');
    expect(db.order('vencido-2')?.status).toBe('EXPIRED');
    expect(db.available(lotA)).toBe(2);
  });

  it('não toca em pedido no prazo nem em outro status', async () => {
    const { db, service } = setup();
    addOrder(db, 'no-prazo', { expiresAt: new Date(FAKE_NOW.getTime() + MINUTE_MS) });
    addOrder(db, 'vence-agora', { expiresAt: FAKE_NOW });
    addOrder(db, 'pix', { status: 'PROCESSING' });
    addOrder(db, 'pago', { status: 'PAID' });

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.expired).toEqual([]);
    expect(db.releases).toEqual([]);
  });

  it('expirar duas vezes devolve o estoque uma vez só', async () => {
    const { db, service } = setup();
    addOrder(db, 'vencido-1');

    await service.expireDue(FAKE_NOW);
    const second = await service.expireDue(FAKE_NOW);

    expect(second.expired).toEqual([]);
    expect(db.available(lotA)).toBe(1);
  });

  it('respeita o tamanho do lote, começando pelos que venceram antes', async () => {
    const { db, service } = setup();
    addOrder(db, 'recente', { expiresAt: ago(1) });
    addOrder(db, 'antigo', { expiresAt: ago(30) });
    addOrder(db, 'meio', { expiresAt: ago(10) });

    const summary = await service.expireDue(FAKE_NOW, 2);

    expect(summary.expired).toEqual(['antigo', 'meio']);
    expect(db.order('recente')?.status).toBe('PENDING');
  });

  it('expira a sessão antes de travar; sem sessão, não chama o Stripe', async () => {
    const { db, expirer, service } = setup();
    addOrder(db, 'com-sessao', { stripeSessionId: 'cs_test_1', expiresAt: ago(2) });
    addOrder(db, 'sem-sessao', { expiresAt: ago(1) });
    let lockedWhenExpiring: string[] | undefined;
    expirer.onCall = () => {
      lockedWhenExpiring = [...db.locks];
    };

    await service.expireDue(FAKE_NOW);

    expect(expirer.calls).toEqual(['cs_test_1']);
    expect(lockedWhenExpiring).toEqual([]);
    expect(db.locks).toEqual(['com-sessao', 'sem-sessao']);
  });

  it('sessão já paga: o pagamento venceu a corrida e o estoque fica', async () => {
    const { db, expirer, service } = setup();
    addOrder(db, 'pago-no-limite', { stripeSessionId: 'cs_test_1' });
    expirer.results.set('cs_test_1', 'complete');

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.paymentCompleted).toEqual(['pago-no-limite']);
    expect(db.order('pago-no-limite')?.status).toBe('PENDING');
    expect(db.releases).toEqual([]);
  });

  it('um erro no Stripe não interrompe o lote', async () => {
    const { db, expirer, service } = setup();
    addOrder(db, 'falha', { stripeSessionId: 'cs_test_falha', expiresAt: ago(2) });
    addOrder(db, 'ok', { expiresAt: ago(1) });
    const outage = new Error('Stripe fora do ar');
    expirer.results.set('cs_test_falha', outage);

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.failed).toEqual([{ orderId: 'falha', error: outage }]);
    expect(summary.expired).toEqual(['ok']);
    expect(db.order('falha')?.status).toBe('PENDING');
  });

  it('um erro ao gravar também fica para a próxima execução', async () => {
    const { db, service } = setup();
    addOrder(db, 'vencido-1');
    db.beforeLock = () => {
      throw new Error('conexão perdida');
    };

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.failed.map((failure) => failure.orderId)).toEqual(['vencido-1']);
    expect(db.order('vencido-1')?.status).toBe('PENDING');
    expect(db.releases).toEqual([]);
  });

  it('pedido que outra execução tratou antes da trava não é expirado de novo', async () => {
    const { db, service } = setup();
    addOrder(db, 'disputado');
    db.beforeLock = (id) => db.commitElsewhere(id, { status: 'CANCELLED' });

    const summary = await service.expireDue(FAKE_NOW);

    expect(summary.alreadyHandled).toEqual(['disputado']);
    expect(db.order('disputado')?.status).toBe('CANCELLED');
    expect(db.releases).toEqual([]);
  });
});
