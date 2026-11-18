import { describe, expect, it } from 'vitest';

import { formatCents, formatEventDate, formatEventDateShort } from './format';

const SHOW = '2026-12-20T23:00:00.000Z';

describe('datas de evento', () => {
  it('saem no fuso do evento, não no de quem navega', () => {
    expect(formatEventDate(SHOW, 'America/Sao_Paulo')).toContain('20:00');
    expect(formatEventDate(SHOW, 'America/Manaus')).toContain('19:00');
  });

  it('a data por extenso traz o dia da semana e o mês em português', () => {
    expect(formatEventDate(SHOW, 'America/Sao_Paulo')).toMatch(/^domingo, 20 de dezembro de 2026/);
  });

  it('a versão curta junta o dia e a hora', () => {
    expect(formatEventDateShort(SHOW, 'America/Sao_Paulo')).toMatch(/20 de dez\. · 20:00$/);
  });

  it('virada de dia no fuso do evento', () => {
    // 02:00 UTC do dia 21 ainda é dia 20 em São Paulo.
    expect(formatEventDate('2026-12-21T02:00:00.000Z', 'America/Sao_Paulo')).toContain(
      '20 de dezembro',
    );
  });
});

describe('formatCents', () => {
  it('centavos em reais, com vírgula', () => {
    expect(formatCents(16_000)).toBe('R$ 160,00');
    expect(formatCents(0)).toBe('R$ 0,00');
  });
});
