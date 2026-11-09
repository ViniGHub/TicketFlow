import { DomainError } from './domain-error.js';

// Regras do catálogo: eventos e lotes (ROADMAP, etapa 2.1). Status HTTP de cada código:
// apps/api/src/common/error-status.ts.

/** Mesmos valores do enum `event_status` do banco; o domínio não depende do Prisma. */
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

export interface SalesWindow {
  salesStart: Date;
  salesEnd: Date;
}

/** Estoque de um lote. Vendido = `total - available` (inclui reservas de pedidos PENDING). */
export interface Stock {
  total: number;
  available: number;
}

/** Também para evento de outro organizador: a resposta não revela que ele existe. */
export class EventNotFoundError extends DomainError {
  readonly code = 'EVENT_NOT_FOUND';

  constructor() {
    super('Evento não encontrado.');
  }
}

export class TicketTypeNotFoundError extends DomainError {
  readonly code = 'TICKET_TYPE_NOT_FOUND';

  constructor(readonly ticketTypeId?: string) {
    super('Lote não encontrado.');
  }
}

export class InvalidSalesWindowError extends DomainError {
  readonly code = 'INVALID_SALES_WINDOW';
}

export class EventInPastError extends DomainError {
  readonly code = 'EVENT_IN_PAST';

  constructor() {
    super('A data do evento precisa estar no futuro.');
  }
}

export class EventNotEditableError extends DomainError {
  readonly code = 'EVENT_NOT_EDITABLE';

  constructor() {
    super('Evento cancelado não pode ser alterado.');
  }
}

export class EventNotDeletableError extends DomainError {
  readonly code = 'EVENT_NOT_DELETABLE';

  constructor() {
    super('Só é possível excluir um evento em rascunho.');
  }
}

export class EventWithoutTicketTypesError extends DomainError {
  readonly code = 'EVENT_WITHOUT_TICKET_TYPES';

  constructor() {
    super('Cadastre ao menos um lote antes de publicar o evento.');
  }
}

export class TicketTypeTotalBelowSoldError extends DomainError {
  readonly code = 'TICKET_TYPE_TOTAL_BELOW_SOLD';

  constructor(
    readonly sold: number,
    readonly requestedTotal: number,
  ) {
    super(
      `O lote já tem ${sold} ingresso(s) vendido(s) ou reservado(s); ` +
        `o total não pode ser ${requestedTotal}.`,
    );
  }
}

/** Evento cancelado não aceita mais alterações (nem nos lotes). */
export function assertEventEditable(status: EventStatus): void {
  if (status === 'CANCELLED') {
    throw new EventNotEditableError();
  }
}

/** Só rascunho pode ser excluído: um evento publicado pode ter pedidos e ingressos. */
export function assertEventDeletable(status: EventStatus): void {
  if (status !== 'DRAFT') {
    throw new EventNotDeletableError();
  }
}

export function assertStartsInFuture(startsAt: Date, now: Date): void {
  if (startsAt.getTime() <= now.getTime()) {
    throw new EventInPastError();
  }
}

/** `sales_start < sales_end <= starts_at`: as vendas terminam até o início do evento. */
export function assertSalesWindow(window: SalesWindow, eventStartsAt: Date): void {
  if (window.salesStart.getTime() >= window.salesEnd.getTime()) {
    throw new InvalidSalesWindowError('O início das vendas precisa ser antes do fim.');
  }
  if (window.salesEnd.getTime() > eventStartsAt.getTime()) {
    throw new InvalidSalesWindowError('As vendas precisam terminar até o início do evento.');
  }
}

/**
 * Nova data do evento: precisa estar no futuro e continuar depois do fim das vendas de
 * todos os lotes já cadastrados.
 */
export function assertEventSchedule(
  startsAt: Date,
  salesWindows: readonly SalesWindow[],
  now: Date,
): void {
  assertStartsInFuture(startsAt, now);
  for (const window of salesWindows) {
    assertSalesWindow(window, startsAt);
  }
}

export function soldOf(stock: Stock): number {
  return stock.total - stock.available;
}

/**
 * Novo total de um lote. O que já foi vendido ou reservado não muda: o disponível acompanha
 * a diferença. Reduzir abaixo do vendido é recusado.
 */
export function resizeStock(stock: Stock, newTotal: number): Stock {
  const sold = soldOf(stock);
  if (newTotal < sold) {
    throw new TicketTypeTotalBelowSoldError(sold, newTotal);
  }
  return { total: newTotal, available: newTotal - sold };
}

export interface PublishCandidate {
  status: EventStatus;
  startsAt: Date;
  ticketTypeCount: number;
}

/**
 * Publicar é idempotente: evento já publicado não muda. Rascunho só publica com ao menos um
 * lote e data no futuro.
 */
export function decidePublish(event: PublishCandidate, now: Date): 'publish' | 'already-published' {
  assertEventEditable(event.status);
  if (event.status === 'PUBLISHED') {
    return 'already-published';
  }
  if (event.ticketTypeCount === 0) {
    throw new EventWithoutTicketTypesError();
  }
  assertStartsInFuture(event.startsAt, now);
  return 'publish';
}
