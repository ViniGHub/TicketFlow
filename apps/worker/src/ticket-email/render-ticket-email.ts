import { SEND_TICKET_EMAIL_JOB } from '@ticketflow/contracts';

import { escapeHtml, formatEventDate } from '../email/email-format';
import { type EmailImage, type EmailMessage } from '../email/email-message';

import { qrCodePng } from './qr-code';

// Conteúdo do e-mail de ingressos (ROADMAP, etapa 5.2; ADR 0013).

export interface TicketEmailEvent {
  id: string;
  title: string;
  venue: string;
  startsAt: Date;
  /** Fuso IANA do evento: a data sai no horário local de quem vai, não no do servidor. */
  timezone: string;
}

export interface TicketEmailTicket {
  id: string;
  qrToken: string;
  ticketTypeName: string;
  event: TicketEmailEvent;
}

export interface TicketEmailInput {
  orderId: string;
  buyer: { name: string; email: string };
  tickets: readonly TicketEmailTicket[];
}

export function contentIdOf(ticketId: string): string {
  return `ingresso-${ticketId}@ticketflow`;
}

/**
 * Um e-mail com todos os ingressos do pedido, agrupados por evento, cada um com o QR embutido
 * no HTML. O texto puro repete tudo, com o código no lugar da imagem.
 */
export async function renderTicketEmail(
  { orderId, buyer, tickets }: TicketEmailInput,
  qrPng: (qrToken: string) => Promise<Buffer> = qrCodePng,
): Promise<EmailMessage> {
  const groups = groupByEvent(tickets);
  const images: EmailImage[] = [];
  const htmlSections: string[] = [];
  const textSections: string[] = [];

  for (const { event, tickets: eventTickets } of groups) {
    const date = formatEventDate(event.startsAt, event.timezone);
    const htmlTickets: string[] = [];
    const textTickets: string[] = [];

    for (const [index, ticket] of eventTickets.entries()) {
      const position = `${index + 1} de ${eventTickets.length}`;
      const contentId = contentIdOf(ticket.id);
      images.push({
        contentId,
        filename: `ingresso-${images.length + 1}.png`,
        contentType: 'image/png',
        content: await qrPng(ticket.qrToken),
      });
      htmlTickets.push(
        `<div style="margin:24px 0;padding:16px;border:1px solid #ddd;border-radius:8px">` +
          `<p style="margin:0 0 8px"><strong>${escapeHtml(ticket.ticketTypeName)}</strong> ` +
          `· ingresso ${position}</p>` +
          `<img src="cid:${contentId}" alt="QR code do ingresso ${position}" ` +
          `width="240" height="240" style="display:block">` +
          `<p style="margin:8px 0 0;font-family:monospace;font-size:12px;color:#555">` +
          `${escapeHtml(ticket.qrToken)}</p>` +
          `</div>`,
      );
      textTickets.push(
        `- ${ticket.ticketTypeName}, ingresso ${position}: código ${ticket.qrToken}`,
      );
    }

    htmlSections.push(
      `<h2 style="margin:32px 0 4px">${escapeHtml(event.title)}</h2>` +
        `<p style="margin:0">${escapeHtml(date)}<br>${escapeHtml(event.venue)}</p>` +
        htmlTickets.join(''),
    );
    textSections.push([`${event.title}`, `${date}`, `${event.venue}`, ...textTickets].join('\n'));
  }

  const greeting = `Olá, ${buyer.name}.`;
  const intro =
    'Seu pagamento foi confirmado. Apresente cada QR code na entrada: ele vale uma vez.';
  const html =
    `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222">` +
    `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>` +
    htmlSections.join('') +
    `<p style="color:#777;font-size:12px">Pedido ${escapeHtml(orderId)}</p>` +
    `</body></html>`;
  const text = [greeting, intro, ...textSections, `Pedido ${orderId}`].join('\n\n');

  return {
    to: { email: buyer.email, name: buyer.name },
    subject: subjectOf(tickets.length, groups),
    html,
    text,
    images,
    idempotencyKey: `${SEND_TICKET_EMAIL_JOB}:${orderId}`,
  };
}

interface EventGroup {
  event: TicketEmailEvent;
  tickets: TicketEmailTicket[];
}

/** Ingressos agrupados por evento, os eventos em ordem de data. */
function groupByEvent(tickets: readonly TicketEmailTicket[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const ticket of tickets) {
    const group = groups.get(ticket.event.id);
    if (group) {
      group.tickets.push(ticket);
    } else {
      groups.set(ticket.event.id, { event: ticket.event, tickets: [ticket] });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.event.startsAt.getTime() - b.event.startsAt.getTime(),
  );
}

function subjectOf(ticketCount: number, groups: readonly EventGroup[]): string {
  const noun = ticketCount === 1 ? 'Seu ingresso' : 'Seus ingressos';
  const [only] = groups;
  return groups.length === 1 && only
    ? `${noun} para ${only.event.title}`
    : `${noun} para ${groups.length} eventos`;
}
