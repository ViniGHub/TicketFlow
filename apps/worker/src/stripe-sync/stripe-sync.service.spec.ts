import {
  type ExpirationService,
  type ExpirationSummary,
  type ReconcileResult,
  type ReconciliationSummary,
  type StripeReconciler,
} from '@ticketflow/domain';
import { describe, expect, it, vi } from 'vitest';

import { StripeSyncService } from './stripe-sync.service';

const NOW = new Date('2026-11-20T12:00:00Z');
const stripeDown = new Error('Stripe fora do ar');

function setup(summary: Partial<ExpirationSummary> = {}) {
  const expireDue = vi.fn((_now: Date) =>
    Promise.resolve({
      expired: [],
      alreadyHandled: [],
      paymentCompleted: [],
      failed: [],
      ...summary,
    }),
  );
  const reconcileOrder = vi.fn((orderId: string, _now: Date): Promise<ReconcileResult | null> =>
    orderId === 'quebrado'
      ? Promise.reject(stripeDown)
      : Promise.resolve({ status: 'processed', orderId, orderStatus: 'PAID' }),
  );
  const reconcileAwaitingPayment = vi.fn((_now: Date): Promise<ReconciliationSummary> =>
    Promise.resolve({ reconciled: [], failed: [] }),
  );
  const service = new StripeSyncService(
    { expireDue } as unknown as ExpirationService,
    { reconcileOrder, reconcileAwaitingPayment } as unknown as StripeReconciler,
  );
  return { service, expireDue, reconcileOrder, reconcileAwaitingPayment };
}

describe('StripeSyncService.expireOrders', () => {
  it('repassa o que a expiração fez', async () => {
    const failure = { orderId: 'falhou', error: stripeDown };
    const { service, expireDue, reconcileOrder } = setup({
      expired: ['vencido'],
      alreadyHandled: ['cancelado'],
      failed: [failure],
    });

    const report = await service.expireOrders(NOW);

    expect(expireDue).toHaveBeenCalledWith(NOW);
    expect(report).toEqual({
      expired: ['vencido'],
      alreadyHandled: ['cancelado'],
      paid: [],
      failed: [failure],
    });
    expect(reconcileOrder).not.toHaveBeenCalled();
  });

  it('sessão já paga: aplica o pagamento pelo reconciliador, sem esperar o webhook', async () => {
    const { service, reconcileOrder } = setup({ paymentCompleted: ['pago-no-limite'] });

    const report = await service.expireOrders(NOW);

    expect(reconcileOrder).toHaveBeenCalledWith('pago-no-limite', NOW);
    expect(report.paid).toEqual([
      {
        orderId: 'pago-no-limite',
        result: { status: 'processed', orderId: 'pago-no-limite', orderStatus: 'PAID' },
      },
    ]);
  });

  it('erro ao aplicar um pagamento não impede os outros; o pedido fica para depois', async () => {
    const { service } = setup({ paymentCompleted: ['quebrado', 'ok'] });

    const report = await service.expireOrders(NOW);

    expect(report.paid.map(({ orderId }) => orderId)).toEqual(['ok']);
    expect(report.failed).toEqual([{ orderId: 'quebrado', error: stripeDown }]);
  });
});

describe('StripeSyncService.reconcile', () => {
  it('reconcilia os pedidos esperando pagamento', async () => {
    const { service, reconcileAwaitingPayment } = setup();

    await expect(service.reconcile(NOW)).resolves.toEqual({ reconciled: [], failed: [] });
    expect(reconcileAwaitingPayment).toHaveBeenCalledWith(NOW);
  });
});
