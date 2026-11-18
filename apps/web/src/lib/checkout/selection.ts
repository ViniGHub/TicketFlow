import { ORDER_LIMITS } from '@ticketflow/contracts';

import { ApiError } from '../api/errors';

// Escolha de ingressos e tentativa de compra (ROADMAP, etapa 6.2; ADR 0017).

/** Quantidade escolhida por lote (id do lote → quantidade). */
export type Selection = Readonly<Record<string, number>>;

export interface OrderItem {
  ticketTypeId: string;
  quantity: number;
}

/** Nova quantidade do lote, entre 0 e o máximo que a tela oferece para ele. */
export function setQuantity(
  selection: Selection,
  lotId: string,
  quantity: number,
  max: number,
): Selection {
  const clamped = Math.max(0, Math.min(Math.trunc(quantity), max));
  return { ...selection, [lotId]: clamped };
}

/** Itens do pedido: só os lotes com quantidade, em ordem de id (o corpo fica estável). */
export function orderItems(selection: Selection): OrderItem[] {
  return Object.entries(selection)
    .filter(([, quantity]) => quantity > 0)
    .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
    .sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : 1));
}

export function selectionTotal(
  selection: Selection,
  lots: readonly { id: string; priceCents: number }[],
): number {
  return lots.reduce((total, lot) => total + lot.priceCents * (selection[lot.id] ?? 0), 0);
}

/** A API aceita até 10 lotes diferentes por pedido. */
export function tooManyLots(items: readonly OrderItem[]): boolean {
  return items.length > ORDER_LIMITS.maxItems;
}

export interface Attempt {
  /** Os itens que esta tentativa envia, como texto estável. */
  signature: string;
  idempotencyKey: string;
}

/**
 * A tentativa de compra para estes itens: a mesma enquanto a seleção não muda, com a mesma
 * `Idempotency-Key`; outra, com chave nova, quando muda.
 */
export function attemptFor(
  current: Attempt | null,
  items: readonly OrderItem[],
  newKey: () => string,
): Attempt {
  const signature = JSON.stringify(items);
  return current?.signature === signature ? current : { signature, idempotencyKey: newKey() };
}

/**
 * Depois de um erro, a tentativa só continua (mesma chave) quando não se sabe se o pedido foi
 * criado: falha de rede. Qualquer resposta da API encerra a tentativa. Depois de um 503, por
 * exemplo, a API já cancelou o pedido daquela chave, e repeti-la devolveria o pedido cancelado.
 */
export function keepsAttemptAfter(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NETWORK';
}
