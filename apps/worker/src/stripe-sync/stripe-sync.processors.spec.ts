import { Logger } from '@nestjs/common';
import { type ReconciliationSummary } from '@ticketflow/domain';
import { type Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpireOrdersProcessor } from './expire-orders.processor';
import { ReconcileStripeProcessor } from './reconcile-stripe.processor';
import { type ExpireOrdersReport, type StripeSyncService } from './stripe-sync.service';

const stripeDown = new Error('Stripe fora do ar');

function job(queueName: string): Job {
  return { id: 'repeat:1', queueName, data: {} } as unknown as Job;
}

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consumidor expire-orders', () => {
  function setup(report: ExpireOrdersReport) {
    const expireOrders = vi.fn((_now: Date) => Promise.resolve(report));
    const processor = new ExpireOrdersProcessor({ expireOrders } as unknown as StripeSyncService);
    return { processor, expireOrders };
  }

  it('devolve quantos pedidos caíram em cada caso e registra cada um', async () => {
    const { processor, expireOrders } = setup({
      expired: ['vencido-1', 'vencido-2'],
      alreadyHandled: ['cancelado'],
      paid: [
        {
          orderId: 'pago-no-limite',
          result: { status: 'processed', orderId: 'pago-no-limite', orderStatus: 'PAID' },
        },
      ],
      failed: [{ orderId: 'falhou', error: stripeDown }],
    });

    const result = await processor.process(job('expire-orders'));

    expect(expireOrders).toHaveBeenCalledWith(expect.any(Date));
    expect(result).toEqual({ expired: 2, alreadyHandled: 1, paid: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'vencido-1', queue: 'expire-orders' }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'pago-no-limite', outcome: 'processed' }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'falhou', error: 'Stripe fora do ar' }),
    );
  });

  it('nada vencido: nenhum log além da conclusão', async () => {
    const { processor } = setup({ expired: [], alreadyHandled: [], paid: [], failed: [] });

    await expect(processor.process(job('expire-orders'))).resolves.toEqual({
      expired: 0,
      alreadyHandled: 0,
      paid: 0,
      failed: 0,
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('consumidor reconcile-stripe', () => {
  function setup(summary: ReconciliationSummary) {
    const reconcile = vi.fn((_now: Date) => Promise.resolve(summary));
    const processor = new ReconcileStripeProcessor({ reconcile } as unknown as StripeSyncService);
    return { processor, reconcile };
  }

  it('conta os pedidos e avisa dos que mudaram: o webhook deles não chegou', async () => {
    const { processor } = setup({
      reconciled: [
        {
          orderId: 'pago',
          result: { status: 'processed', orderId: 'pago', orderStatus: 'PAID' },
        },
        { orderId: 'aberto', result: { status: 'still-open' } },
        { orderId: 'repetido', result: { status: 'duplicate' } },
      ],
      failed: [{ orderId: 'falhou', error: stripeDown }],
    });

    const result = await processor.process(job('reconcile-stripe'));

    expect(result).toEqual({ checked: 4, updated: 1, stillOpen: 1, failed: 1 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'pago', orderStatus: 'PAID' }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'falhou', error: 'Stripe fora do ar' }),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('inclui o aviso do processador, como o pagamento tardio', async () => {
    const { processor } = setup({
      reconciled: [
        {
          orderId: 'tardio',
          result: {
            status: 'processed',
            orderId: 'tardio',
            orderStatus: 'REFUND_PENDING',
            warning: 'late-payment-refund',
          },
        },
      ],
      failed: [],
    });

    await processor.process(job('reconcile-stripe'));

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'tardio', warning: 'late-payment-refund' }),
    );
  });
});
