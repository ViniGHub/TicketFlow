import { DomainError } from './domain-error.js';

// Check-in na entrada do evento (ROADMAP, etapa 4.4; ARCHITECTURE.md, seção 9; ADR 0011). O
// check-in em si é um UPDATE atômico, que só marca o ingresso válido do próprio evento. Quando
// ele não altera nada, estas regras dizem por quê, a partir do ingresso como está no banco.

/** `qr_token` que não corresponde a ingresso nenhum. */
export class TicketNotFoundError extends DomainError {
  readonly code = 'TICKET_NOT_FOUND';

  constructor() {
    super('Ingresso não encontrado.');
  }
}

/** O ingresso existe, mas é de outro evento: a entrada não é esta. */
export class TicketFromOtherEventError extends DomainError {
  readonly code = 'TICKET_FROM_OTHER_EVENT';

  constructor() {
    super('Este ingresso é de outro evento.');
  }
}

/** O pedido foi reembolsado e o ingresso, anulado. */
export class TicketVoidedError extends DomainError {
  readonly code = 'TICKET_VOIDED';

  constructor(readonly voidedAt: Date) {
    super('Ingresso cancelado: o pedido foi reembolsado.');
  }
}

/** O ingresso já passou pela entrada. */
export class TicketAlreadyUsedError extends DomainError {
  readonly code = 'TICKET_ALREADY_USED';

  constructor(readonly checkedInAt: Date) {
    super(`Ingresso já utilizado em ${checkedInAt.toISOString()}.`);
  }
}

/** O que o check-in precisa saber de um ingresso recusado. */
export interface CheckInTicket {
  eventId: string;
  checkedInAt: Date | null;
  voidedAt: Date | null;
}

/**
 * Por que o check-in no evento `eventId` foi recusado. A ordem importa: ingresso de outro
 * evento é recusado antes de qualquer outra coisa, para a resposta não revelar o estado de um
 * ingresso alheio; anulado vem antes de usado, porque o reembolso é o fato mais recente.
 */
export function checkInRejection(ticket: CheckInTicket | null, eventId: string): DomainError {
  if (!ticket) {
    return new TicketNotFoundError();
  }
  if (ticket.eventId !== eventId) {
    return new TicketFromOtherEventError();
  }
  if (ticket.voidedAt) {
    return new TicketVoidedError(ticket.voidedAt);
  }
  if (ticket.checkedInAt) {
    return new TicketAlreadyUsedError(ticket.checkedInAt);
  }
  // O UPDATE do check-in marcaria este ingresso: chegar aqui é erro de quem chamou.
  throw new Error('O ingresso está válido para este evento; o check-in não foi recusado.');
}
