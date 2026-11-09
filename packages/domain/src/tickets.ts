import { randomBytes } from 'node:crypto';

import { type Order } from './order.js';
import { type NewTicket } from './ports.js';

// Ingressos de um pedido pago (ROADMAP, etapa 4.2; ARCHITECTURE.md, seções 3 e 10).

/** Bytes aleatórios do `qr_token`: 256 bits, impossível de adivinhar ou enumerar. */
export const QR_TOKEN_BYTES = 32;

/** `qr_token` novo: aleatório e não sequencial, em base64url (43 caracteres, sem `=`). */
export function generateQrToken(): string {
  return randomBytes(QR_TOKEN_BYTES).toString('base64url');
}

/** Um ingresso por unidade comprada, na ordem dos itens do pedido. */
export function ticketsFor(order: Order, newQrToken: () => string = generateQrToken): NewTicket[] {
  return order.items.flatMap(({ ticketTypeId, quantity }) =>
    Array.from({ length: quantity }, () => ({
      orderId: order.id,
      ticketTypeId,
      qrToken: newQrToken(),
    })),
  );
}

/** Situação do ingresso para o comprador e na entrada (ARCHITECTURE.md, seção 9). */
export type TicketStatus = 'VALID' | 'USED' | 'VOIDED';

/**
 * Anulado prevalece sobre usado: um ingresso reembolsado depois do check-in é mostrado como
 * cancelado, o fato mais recente.
 */
export function ticketStatusOf(ticket: {
  checkedInAt: Date | null;
  voidedAt: Date | null;
}): TicketStatus {
  if (ticket.voidedAt) {
    return 'VOIDED';
  }
  return ticket.checkedInAt ? 'USED' : 'VALID';
}
