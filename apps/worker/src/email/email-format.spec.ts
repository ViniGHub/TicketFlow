import { describe, expect, it } from 'vitest';

import { escapeHtml, formatCents, formatEventDate } from './email-format';

describe('formatação', () => {
  it('a mesma hora UTC aparece no horário local de cada evento', () => {
    const at = new Date('2026-12-20T23:00:00Z');

    expect(formatEventDate(at, 'America/Sao_Paulo')).toContain('20:00');
    expect(formatEventDate(at, 'America/Manaus')).toContain('19:00');
  });

  it('valor em centavos sai em reais, com vírgula', () => {
    // Intl separa "R$" do número com espaço não separável (U+00A0).
    expect(formatCents(16_000)).toBe('R$ 160,00');
    expect(formatCents(5)).toBe('R$ 0,05');
  });

  it('escapa os caracteres especiais do HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
