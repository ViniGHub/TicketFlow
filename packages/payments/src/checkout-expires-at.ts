import { type CheckoutSessionRequest } from '@ticketflow/domain';

const MINUTE_MS = 60_000;

/** O Stripe aceita `expires_at` de 30 min a 24 h depois de criar a sessão. */
export const STRIPE_SESSION_MIN_TTL_MS = 30 * MINUTE_MS;
export const STRIPE_SESSION_MAX_TTL_MS = 24 * 60 * MINUTE_MS;

/**
 * Folga sobre os limites do Stripe: cobre o tempo entre o commit do pedido e a chamada e a
 * diferença de relógio entre o banco, a API e o Stripe. É também a janela em que uma
 * retentativa de um pedido sem sessão ainda é aceita (ADR 0008).
 */
export const SESSION_TTL_MARGIN_MS = 5 * MINUTE_MS;

/**
 * `expires_at` da Checkout Session, em segundos Unix: o fim da reserva, ajustado ao intervalo
 * que o Stripe aceita. A referência é a criação do pedido, nunca o relógio: uma retentativa
 * com a mesma chave de idempotência calcula o mesmo valor, e o Stripe não a recusa.
 *
 * Com o TTL padrão de 30 min, a sessão vale 35 min; o job de expiração encerra a sessão quando
 * o pedido vence (ARCHITECTURE.md, seção 5).
 */
export function checkoutExpiresAt({
  expiresAt,
  orderCreatedAt,
}: Pick<CheckoutSessionRequest, 'expiresAt' | 'orderCreatedAt'>): number {
  const createdAt = orderCreatedAt.getTime();
  const earliest = createdAt + STRIPE_SESSION_MIN_TTL_MS + SESSION_TTL_MARGIN_MS;
  const latest = createdAt + STRIPE_SESSION_MAX_TTL_MS - SESSION_TTL_MARGIN_MS;
  const clamped = Math.min(Math.max(expiresAt.getTime(), earliest), latest);
  return Math.floor(clamped / 1000);
}
