import { Logger } from '@nestjs/common';
import { type Order, type TransactionalRepositories, type UnitOfWork } from '@ticketflow/domain';
import { FakePaymentGateway } from '@ticketflow/payments/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RefundOrderProcessor } from './refund-order.processor';

const ORDER_ID = '0193a4f2-0000-7000-8000-000000000001';

/** Unidade de trabalho de mentira: o reembolso só lê o pedido. */
function unitOfWorkWith(order: Partial<Order> | null): UnitOfWork {
  const orders = {
    findById: () =>
      Promise.resolve(
        order && ({ id: ORDER_ID, stripePaymentIntentId: 'pi_1', ...order } as Order),
      ),
  };
  return {
    run: (work) => work({ orders } as unknown as TransactionalRepositories),
  };
}

function setup(order: Partial<Order> | null) {
  const gateway = new FakePaymentGateway();
  const processor = new RefundOrderProcessor(unitOfWorkWith(order), gateway);
  return { processor, gateway };
}

function job(data: unknown): Job {
  return { id: 'outbox-1', queueName: 'refund-order', data } as unknown as Job;
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

describe('consumidor refund-order', () => {
  it('pede o reembolso do pedido em REFUND_PENDING', async () => {
    const { processor, gateway } = setup({ status: 'REFUND_PENDING' });

    await expect(processor.process(job({ orderId: ORDER_ID }))).resolves.toEqual({
      status: 'refund-requested',
    });
    expect(gateway.refunds).toEqual([
      { orderId: ORDER_ID, paymentIntentId: 'pi_1', idempotencyKey: `refund:${ORDER_ID}` },
    ]);
  });

  it.each([{}, { orderId: 'nao-e-uuid' }, null])(
    'payload %j é UnrecoverableError: tentar de novo não adianta',
    async (data) => {
      const { processor, gateway } = setup({ status: 'REFUND_PENDING' });

      await expect(processor.process(job(data))).rejects.toBeInstanceOf(UnrecoverableError);
      expect(gateway.refundCalls).toEqual([]);
    },
  );

  it('pedido já reembolsado termina sem chamar o Stripe, com log comum', async () => {
    const { processor, gateway } = setup({ status: 'REFUNDED' });

    await processor.process(job({ orderId: ORDER_ID }));

    expect(gateway.refundCalls).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ reason: 'already-refunded' }));
  });

  it('pedido inexistente ou fora de REFUND_PENDING vai para o log como aviso', async () => {
    await setup(null).processor.process(job({ orderId: ORDER_ID }));
    await setup({ status: 'PAID' }).processor.process(job({ orderId: ORDER_ID }));

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'order-not-found' }));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'not-refund-pending' }));
  });

  it('erro do Stripe sobe, para o BullMQ tentar de novo', async () => {
    const { processor, gateway } = setup({ status: 'REFUND_PENDING' });
    gateway.failNextRefund(new Error('Stripe fora do ar'));

    await expect(processor.process(job({ orderId: ORDER_ID }))).rejects.toThrow(
      'Stripe fora do ar',
    );
  });
});
