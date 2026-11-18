// Data e hora digitadas no fuso do evento (ROADMAP, etapa 6.3; ADR 0018). O campo
// `datetime-local` do navegador não tem fuso: "20/12 20:00" num evento de Manaus é 20h em
// Manaus, não no computador de quem digita. A conversão usa só o Intl, sem biblioteca.

/** Fusos do Brasil oferecidos no formulário, com o nome que o organizador reconhece. */
export const BRAZIL_TIME_ZONES: readonly { id: string; label: string }[] = [
  { id: 'America/Sao_Paulo', label: 'Horário de Brasília' },
  { id: 'America/Manaus', label: 'Amazonas (Manaus)' },
  { id: 'America/Cuiaba', label: 'Mato Grosso (Cuiabá)' },
  { id: 'America/Campo_Grande', label: 'Mato Grosso do Sul (Campo Grande)' },
  { id: 'America/Porto_Velho', label: 'Rondônia (Porto Velho)' },
  { id: 'America/Boa_Vista', label: 'Roraima (Boa Vista)' },
  { id: 'America/Rio_Branco', label: 'Acre (Rio Branco)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha' },
];

export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** O relógio de parede do fuso no instante `ms`, como se fosse UTC. */
function wallClockMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

/**
 * `2026-12-20T20:00` no fuso `timeZone` em ISO UTC (`2026-12-20T23:00:00.000Z` em Brasília).
 * Duas passadas acertam a diferença do fuso também perto de uma troca de horário de verão.
 * Texto fora do formato do `datetime-local`: `null`.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const match = LOCAL.exec(local);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (ms: number) => wallClockMs(ms, timeZone) - ms;
  const first = asUtc - offset(asUtc);
  const second = asUtc - offset(first);
  return new Date(second).toISOString();
}

/** O contrário, para preencher o campo ao editar: o ISO UTC como `datetime-local` no fuso. */
export function isoToZonedLocal(iso: string, timeZone: string): string {
  return new Date(wallClockMs(Date.parse(iso), timeZone)).toISOString().slice(0, 16);
}

/** Os fusos do formulário, com o fuso atual do evento se ele não estiver na lista. */
export function timeZoneOptions(current?: string): { id: string; label: string }[] {
  if (!current || BRAZIL_TIME_ZONES.some((zone) => zone.id === current)) {
    return [...BRAZIL_TIME_ZONES];
  }
  return [...BRAZIL_TIME_ZONES, { id: current, label: current }];
}
