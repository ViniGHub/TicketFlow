import { type Job, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { SendTicketEmailProcessor } from './send-ticket-email.processor';
import { type TicketEmailResult, type TicketEmailService } from './ticket-email.service';

const ORDER_ID = '0193a4f2-0000-7000-8000-000000000001';

function setup(result: TicketEmailResult = { status: 'sent', tickets: 2 }) {
  const sendForOrder = vi.fn((_orderId: string) => Promise.resolve(result));
  const processor = new SendTicketEmailProcessor({ sendForOrder } as unknown as TicketEmailService);
  return { processor, sendForOrder };
}

function job(data: unknown): Job {
  return { id: 'outbox-1', queueName: 'send-ticket-email', data } as unknown as Job;
}

describe('consumidor send-ticket-email', () => {
  it('envia os ingressos do pedido do payload', async () => {
    const { processor, sendForOrder } = setup();

    await expect(processor.process(job({ orderId: ORDER_ID }))).resolves.toEqual({
      status: 'sent',
      tickets: 2,
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

  it('nada a enviar termina o job sem erro', async () => {
    const { processor } = setup({ status: 'skipped', reason: 'no-pending-tickets' });

    await expect(processor.process(job({ orderId: ORDER_ID }))).resolves.toEqual({
      status: 'skipped',
      reason: 'no-pending-tickets',
    });
  });
});
