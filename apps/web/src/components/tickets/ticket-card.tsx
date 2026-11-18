'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { qrDataUrl, type TicketTone, type TicketView } from '../../lib/tickets/view';
import { cn } from '../ui/cn';

const TONES: Record<TicketTone, string> = {
  success: 'bg-success-soft text-success',
  muted: 'bg-surface-muted text-muted',
  danger: 'bg-danger-soft text-danger',
};

function TicketQr({ qrToken, label }: { qrToken: string; label: string }) {
  const qr = useQuery({
    queryKey: ['qr', qrToken],
    queryFn: () => qrDataUrl(qrToken),
    staleTime: Infinity,
  });
  if (!qr.data) {
    return (
      <div aria-hidden="true" className="size-44 animate-pulse rounded-control bg-surface-muted" />
    );
  }
  // O QR precisa de fundo claro para o leitor da entrada, mesmo no tema escuro.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URL gerada no navegador
    <img
      src={qr.data}
      alt={`QR code do ingresso: ${label}`}
      width={176}
      height={176}
      className="size-44 rounded-control bg-white p-2"
    />
  );
}

export function TicketCard({ ticket }: { ticket: TicketView }) {
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
      {ticket.showQr && (
        <TicketQr qrToken={ticket.qrToken} label={`${ticket.eventTitle}, ${ticket.lotName}`} />
      )}
      <div className="flex flex-col gap-1">
        <span
          className={cn(
            'self-start rounded-full px-2.5 py-0.5 text-xs font-medium',
            TONES[ticket.tone],
          )}
        >
          {ticket.statusLabel}
        </span>
        <Link
          href={`/eventos/${ticket.eventId}`}
          className="text-lg font-semibold hover:text-brand"
        >
          {ticket.eventTitle}
        </Link>
        <span className="text-sm text-brand">{ticket.eventDate}</span>
        <span className="text-sm text-muted">{ticket.venue}</span>
        <span className="text-sm">{ticket.lotName}</span>
        {ticket.showQr && (
          <p className="mt-2 text-xs text-muted">
            Mostre este QR code na entrada. Ele vale uma vez.
          </p>
        )}
      </div>
    </article>
  );
}
