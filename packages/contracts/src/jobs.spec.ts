import { describe, expect, it } from 'vitest';

import {
  EXPIRE_ORDERS_JOB,
  isOutboxJobType,
  OUTBOX_JOB_TYPES,
  RECONCILE_STRIPE_JOB,
  REFUND_ORDER_JOB,
  refundOrderPayloadSchema,
  SEND_TICKET_EMAIL_JOB,
  sendTicketEmailPayloadSchema,
} from './jobs.js';

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

describe('job refund-order', () => {
  it('tem o nome da fila do worker (ARCHITECTURE.md, seção 8)', () => {
    expect(REFUND_ORDER_JOB).toBe('refund-order');
  });

  it('aceita só o id do pedido', () => {
    expect(refundOrderPayloadSchema.parse({ orderId, amount: 100 })).toEqual({ orderId });
  });

  it.each([{}, { orderId: 'nao-e-uuid' }])('recusa %j', (payload) => {
    expect(refundOrderPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('tipos de job da outbox', () => {
  it('reconhece só os jobs que o domínio grava', () => {
    expect(OUTBOX_JOB_TYPES).toEqual(['send-ticket-email', 'refund-order']);
    expect(isOutboxJobType('refund-order')).toBe(true);
    expect(isOutboxJobType('outro-job')).toBe(false);
  });

  it('os jobs recorrentes não passam pela outbox', () => {
    expect(isOutboxJobType(EXPIRE_ORDERS_JOB)).toBe(false);
    expect(isOutboxJobType(RECONCILE_STRIPE_JOB)).toBe(false);
  });
});
