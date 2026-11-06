import { describe, expect, it } from 'vitest';

import { checkoutExpiresAt } from './checkout-expires-at.js';

const MINUTE_MS = 60_000;
const orderCreatedAt = new Date('2026-11-20T12:00:00.123Z');
const minutesAfterCreation = (minutes: number) =>
  new Date(orderCreatedAt.getTime() + minutes * MINUTE_MS);
const unixSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

describe('validade da Checkout Session', () => {
  it.each([
    // TTL da reserva (min) → validade da sessão (min depois da criação do pedido)
    [1, 35],
    [15, 35],
    [30, 35],
    [35, 35],
    [60, 60],
    [12 * 60, 12 * 60],
    [24 * 60, 24 * 60 - 5],
  ])('reserva de %s min: a sessão vale %s min', (ttl, expected) => {
    expect(checkoutExpiresAt({ orderCreatedAt, expiresAt: minutesAfterCreation(ttl) })).toBe(
      unixSeconds(minutesAfterCreation(expected)),
    );
  });

  it('fica sempre dentro do intervalo do Stripe (30 min a 24 h), com 5 min de folga', () => {
    for (let ttl = 1; ttl <= 24 * 60; ttl += 1) {
      const expiresAt = checkoutExpiresAt({ orderCreatedAt, expiresAt: minutesAfterCreation(ttl) });
      const validity = expiresAt * 1000 - orderCreatedAt.getTime();
      expect(validity).toBeGreaterThanOrEqual(35 * MINUTE_MS - 1_000);
      expect(validity).toBeLessThanOrEqual(24 * 60 * MINUTE_MS - 5 * MINUTE_MS);
    }
  });
});
