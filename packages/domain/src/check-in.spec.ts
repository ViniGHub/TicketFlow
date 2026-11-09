import { describe, expect, it } from 'vitest';

import {
  checkInRejection,
  TicketAlreadyUsedError,
  TicketFromOtherEventError,
  TicketNotFoundError,
  TicketVoidedError,
} from './check-in.js';

const EVENT_ID = 'evento-1';
const usedAt = new Date('2026-12-01T20:00:00Z');
const voidedAt = new Date('2026-11-25T10:00:00Z');

describe('check-in recusado', () => {
  it('qr_token sem ingresso: não encontrado', () => {
    expect(checkInRejection(null, EVENT_ID)).toBeInstanceOf(TicketNotFoundError);
  });

  it('ingresso de outro evento é recusado antes de revelar o estado dele', () => {
    const rejection = checkInRejection(
      { eventId: 'evento-2', checkedInAt: usedAt, voidedAt },
      EVENT_ID,
    );

    expect(rejection).toBeInstanceOf(TicketFromOtherEventError);
  });

  it('ingresso anulado, mesmo que já usado: cancelado', () => {
    const rejection = checkInRejection(
      { eventId: EVENT_ID, checkedInAt: usedAt, voidedAt },
      EVENT_ID,
    );

    expect(rejection).toEqual(new TicketVoidedError(voidedAt));
  });

  it('ingresso já usado: informa quando', () => {
    const rejection = checkInRejection(
      { eventId: EVENT_ID, checkedInAt: usedAt, voidedAt: null },
      EVENT_ID,
    );

    expect(rejection).toBeInstanceOf(TicketAlreadyUsedError);
    expect(rejection.message).toContain('2026-12-01T20:00:00.000Z');
  });

  it('ingresso válido do evento não é motivo de recusa', () => {
    expect(() =>
      checkInRejection({ eventId: EVENT_ID, checkedInAt: null, voidedAt: null }, EVENT_ID),
    ).toThrow(/não foi recusado/);
  });

  it.each([
    [new TicketNotFoundError(), 'TICKET_NOT_FOUND'],
    [new TicketFromOtherEventError(), 'TICKET_FROM_OTHER_EVENT'],
    [new TicketVoidedError(voidedAt), 'TICKET_VOIDED'],
    [new TicketAlreadyUsedError(usedAt), 'TICKET_ALREADY_USED'],
  ])('%s tem o código %s', (error, code) => {
    expect(error.code).toBe(code);
  });
});
