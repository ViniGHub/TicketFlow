import { describe, expect, it } from 'vitest';

import { type TicketWithDetails, toMyTicketResponse } from './tickets.mapper';

const startsAt = new Date('2026-12-20T23:00:00Z');

function ticket(overrides: Partial<TicketWithDetails> = {}): TicketWithDetails {
  return {
    id: '0193a4f2-0000-7000-8000-0000000000a1',
    orderId: '0193a4f2-0000-7000-8000-0000000000b1',
    ticketTypeId: '0193a4f2-0000-7000-8000-0000000000c1',
    eventId: '0193a4f2-0000-7000-8000-0000000000d1',
    qrToken: 'bUHxdPPHbw2IBWVB1hgF_zY5KMs2HpWEq_QA7GHi0iw',
    emailedAt: null,
    checkedInAt: null,
    voidedAt: null,
    ticketType: { id: '0193a4f2-0000-7000-8000-0000000000c1', name: 'Pista' },
    event: {
      id: '0193a4f2-0000-7000-8000-0000000000d1',
      title: 'Show de Teste',
      venue: 'Teatro Municipal',
      timezone: 'America/Sao_Paulo',
      startsAt,
    },
    ...overrides,
  };
}

describe('ingresso do comprador', () => {
  it('traz o qrToken, o lote e o evento, com datas em ISO', () => {
    expect(toMyTicketResponse(ticket())).toEqual({
      id: '0193a4f2-0000-7000-8000-0000000000a1',
      orderId: '0193a4f2-0000-7000-8000-0000000000b1',
      qrToken: 'bUHxdPPHbw2IBWVB1hgF_zY5KMs2HpWEq_QA7GHi0iw',
      status: 'VALID',
      checkedInAt: null,
      voidedAt: null,
      ticketType: { id: '0193a4f2-0000-7000-8000-0000000000c1', name: 'Pista' },
      event: {
        id: '0193a4f2-0000-7000-8000-0000000000d1',
        title: 'Show de Teste',
        venue: 'Teatro Municipal',
        timezone: 'America/Sao_Paulo',
        startsAt: '2026-12-20T23:00:00.000Z',
      },
    });
  });

  it('usado e anulado aparecem no status e nas datas', () => {
    const at = new Date('2026-12-20T23:30:00Z');

    expect(toMyTicketResponse(ticket({ checkedInAt: at }))).toMatchObject({
      status: 'USED',
      checkedInAt: '2026-12-20T23:30:00.000Z',
    });
    expect(toMyTicketResponse(ticket({ voidedAt: at }))).toMatchObject({
      status: 'VOIDED',
      voidedAt: '2026-12-20T23:30:00.000Z',
    });
  });
});
