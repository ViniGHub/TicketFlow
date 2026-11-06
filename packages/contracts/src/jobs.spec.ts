import { describe, expect, it } from 'vitest';

import { SEND_TICKET_EMAIL_JOB, sendTicketEmailPayloadSchema } from './jobs.js';

const orderId = '0193a4f2-7c1e-7b3d-9a51-3f0c2d8e4b61';

describe('job send-ticket-email', () => {
  it('tem o nome da fila do worker (ARCHITECTURE.md, seção 8)', () => {
    expect(SEND_TICKET_EMAIL_JOB).toBe('send-ticket-email');
  });

  it('aceita o id do pedido', () => {
    expect(sendTicketEmailPayloadSchema.parse({ orderId })).toEqual({ orderId });
  });

  it('descarta campos que não fazem parte do contrato', () => {
    expect(sendTicketEmailPayloadSchema.parse({ orderId, email: 'a@b.com' })).toEqual({ orderId });
  });

  it.each([{}, { orderId: 'nao-e-uuid' }, { orderId: 42 }])('recusa %j', (payload) => {
    expect(sendTicketEmailPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
