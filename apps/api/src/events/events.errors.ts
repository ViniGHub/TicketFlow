import { DomainError } from '@ticketflow/domain';

// Status HTTP de cada código: common/error-status.ts. As regras do catálogo (janela de
// vendas, total x vendido, publicação) e o TicketTypeNotFoundError, que a compra também usa,
// ficam em packages/domain.

/** Também para evento de outro organizador: a resposta não revela que ele existe. */
export class EventNotFoundError extends DomainError {
  readonly code = 'EVENT_NOT_FOUND';

  constructor() {
    super('Evento não encontrado.');
  }
}
