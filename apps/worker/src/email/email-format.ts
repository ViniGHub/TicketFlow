// Formatação comum aos e-mails do worker.

/** Data e hora do evento no fuso dele, em pt-BR: "domingo, 20 de dezembro de 2026 às 20:00". */
export function formatEventDate(startsAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(startsAt);
}

/** Título, local, lote e nome vêm do organizador e do comprador: nada vira HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos em reais, em pt-BR: 16000 vira "R$ 160,00" (CLAUDE.md, regra 2). */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}
