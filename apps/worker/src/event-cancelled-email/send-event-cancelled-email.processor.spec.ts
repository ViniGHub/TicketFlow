import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type EventCancelledEmailResult,
  type EventCancelledEmailService,
} from './event-cancelled-email.service';
import { SendEventCancelledEmailProcessor } from './send-event-cancelled-email.processor';

const ORDER_ID = '0193a4f2-0000-7000-8000-000000000001';

function setup(result: EventCancelledEmailResult = { status: 'sent' }) {
  const sendForOrder = vi.fn((_orderId: string) => Promise.resolve(result));
  const processor = new SendEventCancelledEmailProcessor({
    sendForOrder,
  } as unknown as EventCancelledEmailService);
  return { processor, sendForOrder };
}

function job(data: unknown): Job {
  return { id: 'outbox-1', queueName: 'send-event-cancelled-email', data } as unknown as Job;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consumidor send-event-cancelled-email', () => {
  it('envia o aviso do pedido do payload', async () => {
    const { processor, sendForOrder } = setup();

    await expect(processor.process(job({ orderId: ORDER_ID }))).resolves.toEqual({
      status: 'sent',
    });
    expect(sendForOrder).toHaveBeenCalledWith(ORDER_ID);
  });

  it.each([{}, { orderId: 'nao-e-uuid' }, null])(
    'payload %j é UnrecoverableError: tentar de novo não adianta',
    async (data) => {
      const { processor, sendForOrder } = setup();

      await expect(processor.process(job(data))).rejects.toBeInstanceOf(UnrecoverableError);
      expect(sendForOrder).not.toHaveBeenCalled();
    },
  );

  it('nada a enviar termina o job com aviso no log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { processor } = setup({ status: 'skipped', reason: 'order-not-found' });

    await processor.process(job({ orderId: ORDER_ID }));

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'order-not-found' }));
  });
});
