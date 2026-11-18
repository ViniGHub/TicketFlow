import { type MyTicketResponse } from '@ticketflow/contracts';
import QRCode from 'qrcode';

import { formatEventDate } from '../format';

// "Meus ingressos" (ROADMAP, etapa 6.2; ADR 0017).

export type TicketTone = 'success' | 'muted' | 'danger';

export interface TicketView {
  id: string;
  qrToken: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  venue: string;
  lotName: string;
  statusLabel: string;
  tone: TicketTone;
  /** Só o ingresso válido mostra o QR: usado ou cancelado não entra mais. */
  showQr: boolean;
}

export function toTicketView(ticket: MyTicketResponse): TicketView {
  const { event } = ticket;
  const base = {
    id: ticket.id,
    qrToken: ticket.qrToken,
    eventId: event.id,
    eventTitle: event.title,
    eventDate: formatEventDate(event.startsAt, event.timezone),
    venue: event.venue,
    lotName: ticket.ticketType.name,
  };
  switch (ticket.status) {
    case 'VALID':
      return { ...base, statusLabel: 'Válido', tone: 'success', showQr: true };
    case 'USED':
      return {
        ...base,
        statusLabel: ticket.checkedInAt
          ? `Usado em ${formatEventDate(ticket.checkedInAt, event.timezone)}`
          : 'Usado',
        tone: 'muted',
        showQr: false,
      };
    case 'VOIDED':
      return { ...base, statusLabel: 'Cancelado (reembolsado)', tone: 'danger', showQr: false };
  }
}

/**
 * QR do ingresso como imagem SVG (data URL). Codifica só o `qr_token`, que é o que o check-in
 * lê, como no e-mail do worker. Quem tem o QR entra: ele só aparece para o dono.
 */
export async function qrDataUrl(qrToken: string): Promise<string> {
  const svg = await QRCode.toString(qrToken, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
