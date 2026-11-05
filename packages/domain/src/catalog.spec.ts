import { describe, expect, it } from 'vitest';

import {
  assertEventDeletable,
  assertEventEditable,
  assertEventSchedule,
  assertSalesWindow,
  assertStartsInFuture,
  decidePublish,
  EventInPastError,
  EventNotDeletableError,
  EventNotEditableError,
  type EventStatus,
  EventWithoutTicketTypesError,
  InvalidSalesWindowError,
  resizeStock,
  soldOf,
  TicketTypeTotalBelowSoldError,
} from './catalog.js';

const now = new Date('2026-11-05T12:00:00Z');
const startsAt = new Date('2026-12-10T23:00:00Z');
const at = (iso: string) => new Date(iso);

describe('janela de vendas', () => {
  it('aceita início antes do fim e fim antes do evento', () => {
    expect(() =>
      assertSalesWindow(
        { salesStart: at('2026-11-01T00:00:00Z'), salesEnd: at('2026-12-10T22:00:00Z') },
        startsAt,
      ),
    ).not.toThrow();
  });

  it('aceita vendas terminando exatamente no início do evento', () => {
    expect(() =>
      assertSalesWindow({ salesStart: at('2026-11-01T00:00:00Z'), salesEnd: startsAt }, startsAt),
    ).not.toThrow();
  });

  it.each([
    ['início igual ao fim', '2026-12-01T00:00:00Z', '2026-12-01T00:00:00Z'],
    ['início depois do fim', '2026-12-02T00:00:00Z', '2026-12-01T00:00:00Z'],
    ['fim depois do evento', '2026-11-01T00:00:00Z', '2026-12-10T23:00:01Z'],
  ])('recusa %s', (_case, salesStart, salesEnd) => {
    expect(() =>
      assertSalesWindow({ salesStart: at(salesStart), salesEnd: at(salesEnd) }, startsAt),
    ).toThrow(InvalidSalesWindowError);
  });
});

describe('data do evento', () => {
  const window = { salesStart: at('2026-11-01T00:00:00Z'), salesEnd: at('2026-12-01T00:00:00Z') };

  it('precisa estar no futuro', () => {
    expect(() => assertStartsInFuture(now, now)).toThrow(EventInPastError);
    expect(() => assertStartsInFuture(at('2026-11-05T11:59:59Z'), now)).toThrow(EventInPastError);
    expect(() => assertStartsInFuture(at('2026-11-05T12:00:01Z'), now)).not.toThrow();
  });

  it('pode mudar se continuar depois do fim das vendas de todos os lotes', () => {
    expect(() => assertEventSchedule(at('2026-12-01T00:00:00Z'), [window], now)).not.toThrow();
  });

  it('não pode ir para antes do fim das vendas de um lote', () => {
    expect(() => assertEventSchedule(at('2026-11-30T23:59:59Z'), [window], now)).toThrow(
      InvalidSalesWindowError,
    );
  });

  it('não pode ir para o passado, mesmo sem lotes', () => {
    expect(() => assertEventSchedule(at('2026-11-01T00:00:00Z'), [], now)).toThrow(
      EventInPastError,
    );
  });
});

describe('total do lote', () => {
  const stock = { total: 100, available: 30 };

  it('vendido é o total menos o disponível', () => {
    expect(soldOf(stock)).toBe(70);
  });

  it('aumentar o total aumenta o disponível na mesma medida', () => {
    expect(resizeStock(stock, 120)).toEqual({ total: 120, available: 50 });
  });

  it('reduzir mantém o vendido', () => {
    expect(resizeStock(stock, 80)).toEqual({ total: 80, available: 10 });
  });

  it('reduzir até exatamente o vendido zera o disponível', () => {
    expect(resizeStock(stock, 70)).toEqual({ total: 70, available: 0 });
  });

  it('reduzir abaixo do vendido é recusado', () => {
    expect(() => resizeStock(stock, 69)).toThrow(TicketTypeTotalBelowSoldError);
  });
});

describe('publicação', () => {
  const draft = { status: 'DRAFT' as const, startsAt, ticketTypeCount: 1 };

  it('publica um rascunho com lote e data no futuro', () => {
    expect(decidePublish(draft, now)).toBe('publish');
  });

  it('sem lote é recusada', () => {
    expect(() => decidePublish({ ...draft, ticketTypeCount: 0 }, now)).toThrow(
      EventWithoutTicketTypesError,
    );
  });

  it('com data no passado é recusada', () => {
    expect(() => decidePublish({ ...draft, startsAt: at('2026-11-01T00:00:00Z') }, now)).toThrow(
      EventInPastError,
    );
  });

  it('de evento já publicado não muda nada', () => {
    expect(decidePublish({ ...draft, status: 'PUBLISHED' }, now)).toBe('already-published');
  });

  it('de evento cancelado é recusada', () => {
    expect(() => decidePublish({ ...draft, status: 'CANCELLED' }, now)).toThrow(
      EventNotEditableError,
    );
  });
});

describe('status do evento', () => {
  it.each<[EventStatus, boolean]>([
    ['DRAFT', true],
    ['PUBLISHED', true],
    ['CANCELLED', false],
  ])('%s editável: %s', (status, editable) => {
    const check = () => assertEventEditable(status);
    if (editable) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow(EventNotEditableError);
    }
  });

  it.each<[EventStatus, boolean]>([
    ['DRAFT', true],
    ['PUBLISHED', false],
    ['CANCELLED', false],
  ])('%s excluível: %s', (status, deletable) => {
    const check = () => assertEventDeletable(status);
    if (deletable) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow(EventNotDeletableError);
    }
  });
});

describe('códigos de erro', () => {
  it('são estáveis para a API mapear o status HTTP', () => {
    expect(new InvalidSalesWindowError('x').code).toBe('INVALID_SALES_WINDOW');
    expect(new EventInPastError().code).toBe('EVENT_IN_PAST');
    expect(new EventNotEditableError().code).toBe('EVENT_NOT_EDITABLE');
    expect(new EventNotDeletableError().code).toBe('EVENT_NOT_DELETABLE');
    expect(new EventWithoutTicketTypesError().code).toBe('EVENT_WITHOUT_TICKET_TYPES');
    expect(new TicketTypeTotalBelowSoldError(5, 4).code).toBe('TICKET_TYPE_TOTAL_BELOW_SOLD');
  });
});
