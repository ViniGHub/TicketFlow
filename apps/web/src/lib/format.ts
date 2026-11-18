// Formatação para a interface, em pt-BR (ROADMAP, etapa 6.2). Datas de evento saem sempre no
// fuso do evento, não no de quem está navegando: o show às 20h em Manaus é às 20h para todos.
// Formate no servidor e passe o texto aos componentes do navegador: o ICU do Node e o do
// navegador podem diferir em detalhes (espaços, abreviações) e quebrar a hidratação.

/** "domingo, 20 de dezembro de 2026 às 20:00" */
export function formatEventDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** "dom., 20 de dez. · 20:00", para cartões e listas. */
export function formatEventDateShort(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${day} · ${time}`;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos em reais: 16000 vira "R$ 160,00" (CLAUDE.md, regra 2). */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}
