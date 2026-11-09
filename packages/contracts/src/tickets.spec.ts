import { describe, expect, it } from 'vitest';

import {
  checkInRequestSchema,
  eventSalesResponseSchema,
  myTicketsQuerySchema,
  qrTokenSchema,
} from './tickets.js';

const qrToken = 'bUHxdPPHbw2IBWVB1hgF_zY5KMs2HpWEq_QA7GHi0iw';

describe('qr_token', () => {
  it('aceita 32 bytes em base64url', () => {
    expect(qrTokenSchema.parse(qrToken)).toBe(qrToken);
  });

  it.each([
    ['curto demais', qrToken.slice(1)],
    ['longo demais', `${qrToken}A`],
    ['com padding', `${qrToken.slice(1)}=`],
    ['com caractere de base64 comum', `${qrToken.slice(1)}+`],
    ['vazio', ''],
  ])('recusa token %s', (_, token) => {
    expect(qrTokenSchema.safeParse(token).success).toBe(false);
  });
});

describe('corpo do POST /events/:id/check-in', () => {
  it('exige o qrToken', () => {
    expect(checkInRequestSchema.safeParse({}).success).toBe(false);
    expect(checkInRequestSchema.parse({ qrToken })).toEqual({ qrToken });
  });
});

describe('GET /me/tickets', () => {
  it('pagina como /me/events: limite padrão de 20, máximo de 50', () => {
    expect(myTicketsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(myTicketsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});

describe('resposta de GET /events/:id/sales', () => {
  const counts = { sold: 0, reserved: 0, revenueCents: 0 };
  const ordersByStatus = {
    PENDING: 0,
    PROCESSING: 0,
    PAID: 0,
    EXPIRED: 0,
    CANCELLED: 0,
    REFUND_PENDING: 0,
    REFUNDED: 0,
  };

  it('traz todos os status de pedido, mesmo com zero', () => {
    const sales = {
      eventId: '0193a4f2-0000-7000-8000-000000000001',
      currency: 'BRL',
      ticketTypes: [],
      totals: counts,
      ordersByStatus,
    };

    expect(eventSalesResponseSchema.parse(sales)).toEqual(sales);
    const { PAID: _paid, ...missingPaid } = ordersByStatus;
    expect(
      eventSalesResponseSchema.safeParse({ ...sales, ordersByStatus: missingPaid }).success,
    ).toBe(false);
  });
});
