import { DomainError } from './domain-error.js';

// Máquina de estados do pedido (ARCHITECTURE.md, seção 4; ADR 0005). Aqui fica só o que é
// permitido; qual transição aplicar é decisão dos serviços (webhook, cancelamento, expiração).

/** Mesmos valores do enum `order_status` do banco; o domínio não depende do Prisma. */
export const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * O que a transição faz com o estoque do pedido, na mesma transação da mudança de status:
 * `release` devolve, `reserve` reserva de novo, `none` não mexe.
 */
export type StockEffect = 'release' | 'reserve' | 'none';

/**
 * Transições permitidas e o efeito de cada uma no estoque. Fora desta tabela, inclusive
 * continuar no mesmo estado, a transição é inválida. Reembolso não devolve estoque: a seção 4
 * só devolve na expiração e no cancelamento de um pedido não pago.
 */
const TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderStatus, StockEffect>>>>
> = {
  PENDING: { PAID: 'none', PROCESSING: 'none', EXPIRED: 'release', CANCELLED: 'release' },
  // Pix: o estoque fica reservado até o Stripe confirmar ou recusar o pagamento.
  PROCESSING: { PAID: 'none', EXPIRED: 'release' },
  // Pagamento tardio: re-reserva se ainda houver estoque; senão, reembolso automático.
  EXPIRED: { PAID: 'reserve', REFUND_PENDING: 'none' },
  PAID: { REFUND_PENDING: 'none' },
  REFUND_PENDING: { REFUNDED: 'none' },
  CANCELLED: {},
  REFUNDED: {},
};

export class InvalidOrderTransitionError extends DomainError {
  readonly code = 'INVALID_ORDER_TRANSITION';

  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Pedido em ${from} não pode passar para ${to}.`);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from][to] !== undefined;
}

/** Efeito da transição no estoque. Lança `InvalidOrderTransitionError` se ela não é permitida. */
export function stockEffectOf(from: OrderStatus, to: OrderStatus): StockEffect {
  const effect = TRANSITIONS[from][to];
  if (effect === undefined) {
    throw new InvalidOrderTransitionError(from, to);
  }
  return effect;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  stockEffectOf(from, to);
}
