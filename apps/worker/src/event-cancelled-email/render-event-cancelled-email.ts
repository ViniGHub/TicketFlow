import { SEND_EVENT_CANCELLED_EMAIL_JOB } from '@ticketflow/contracts';

import { escapeHtml, formatCents, formatEventDate } from '../email/email-format';
import { type EmailMessage } from '../email/email-message';

// Conteúdo do e-mail de evento cancelado (ROADMAP, etapa 5.4; ADR 0015).

export interface CancelledEvent {
  title: string;
  venue: string;
  startsAt: Date;
  /** Fuso IANA do evento: a data sai no horário local de quem ia. */
  timezone: string;
}

export interface EventCancelledEmailInput {
  orderId: string;
  buyer: { name: string; email: string };
  /** Eventos cancelados do pedido, em ordem de data. */
  events: readonly CancelledEvent[];
  /** Ingressos do pedido: todos ficam cancelados, porque o pedido é reembolsado inteiro. */
  ticketCount: number;
  /** Valor devolvido, em centavos; zero quando o pedido não teve cobrança. */
  refundCents: number;
}

/** Um e-mail por pedido: o que foi cancelado, os ingressos que deixam de valer e o reembolso. */
export function renderEventCancelledEmail({
  orderId,
  buyer,
  events,
  ticketCount,
  refundCents,
}: EventCancelledEmailInput): EmailMessage {
  const greeting = `Olá, ${buyer.name}.`;
  const eventLines = events.map(
    (event) =>
      `${event.title}, ${formatEventDate(event.startsAt, event.timezone)}, em ${event.venue}`,
  );
  const cancelled =
    events.length === 1
      ? 'O organizador cancelou este evento:'
      : 'O organizador cancelou estes eventos:';
  const tickets =
    ticketCount === 1
      ? 'O ingresso do seu pedido foi cancelado e não vale mais na entrada.'
      : `Os ${ticketCount} ingressos do seu pedido foram cancelados e não valem mais na entrada.`;
  const refund =
    refundCents > 0
      ? `O valor de ${formatCents(refundCents)} vai ser devolvido na forma de pagamento usada na ` +
        'compra. O prazo para aparecer depende do banco ou da operadora do cartão.'
      : 'O pedido não teve cobrança, então não há valor a devolver.';
  const footer = `Pedido ${orderId}`;

  const html =
    `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(cancelled)}</p>` +
    `<ul>${eventLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` +
    `<p>${escapeHtml(tickets)}</p>` +
    `<p>${escapeHtml(refund)}</p>` +
    `<p style="color:#777;font-size:12px">${escapeHtml(footer)}</p>` +
    `</body></html>`;
  const text = [
    greeting,
    [cancelled, ...eventLines.map((line) => `- ${line}`)].join('\n'),
    tickets,
    refund,
    footer,
  ].join('\n\n');

  const [only] = events;
  return {
    to: { email: buyer.email, name: buyer.name },
    subject:
      events.length === 1 && only
        ? `Evento cancelado: ${only.title}`
        : `${events.length} eventos do seu pedido foram cancelados`,
    html,
    text,
    images: [],
    idempotencyKey: `${SEND_EVENT_CANCELLED_EMAIL_JOB}:${orderId}`,
  };
}
