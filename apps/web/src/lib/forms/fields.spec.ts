import { describe, expect, it } from 'vitest';

import { centsToReaisInput, parseReais } from './money';
import { isoToZonedLocal, timeZoneOptions, zonedLocalToIso } from './zoned-time';

describe('zonedLocalToIso', () => {
  it('a hora digitada vale no fuso do evento', () => {
    expect(zonedLocalToIso('2026-12-20T20:00', 'America/Sao_Paulo')).toBe(
      '2026-12-20T23:00:00.000Z',
    );
    expect(zonedLocalToIso('2026-12-20T20:00', 'America/Manaus')).toBe('2026-12-21T00:00:00.000Z');
    expect(zonedLocalToIso('2026-12-20T20:00', 'America/Noronha')).toBe('2026-12-20T22:00:00.000Z');
  });

  it('acerta a diferença perto da troca do horário de verão', () => {
    // Nova York: horário de verão (UTC-4) em julho, padrão (UTC-5) em dezembro.
    expect(zonedLocalToIso('2026-07-01T12:00', 'America/New_York')).toBe(
      '2026-07-01T16:00:00.000Z',
    );
    expect(zonedLocalToIso('2026-12-01T12:00', 'America/New_York')).toBe(
      '2026-12-01T17:00:00.000Z',
    );
  });

  it('texto fora do formato do campo é recusado', () => {
    expect(zonedLocalToIso('20/12/2026 20:00', 'America/Sao_Paulo')).toBeNull();
    expect(zonedLocalToIso('', 'America/Sao_Paulo')).toBeNull();
  });

  it('o caminho de volta preenche o campo para editar', () => {
    expect(isoToZonedLocal('2026-12-21T00:00:00.000Z', 'America/Manaus')).toBe('2026-12-20T20:00');
    const local = '2026-03-15T09:30';
    expect(
      isoToZonedLocal(zonedLocalToIso(local, 'America/Sao_Paulo') ?? '', 'America/Sao_Paulo'),
    ).toBe(local);
  });

  it('um fuso fora da lista do Brasil entra nas opções ao editar', () => {
    expect(timeZoneOptions('America/Sao_Paulo')).toHaveLength(8);
    expect(timeZoneOptions('Europe/Lisbon').at(-1)).toEqual({
      id: 'Europe/Lisbon',
      label: 'Europe/Lisbon',
    });
  });
});

describe('parseReais', () => {
  it.each([
    ['80', 8_000],
    ['80,5', 8_050],
    ['80,50', 8_050],
    ['0,29', 29],
    ['1.234,56', 123_456],
    ['R$ 80,00', 8_000],
    ['0', 0],
  ])('"%s" vira %i centavos', (text, cents) => {
    expect(parseReais(text)).toBe(cents);
  });

  it.each(['', 'abc', '80.5', '80,505', '-10', '1.23,45'])('"%s" é recusado', (text) => {
    expect(parseReais(text)).toBeNull();
  });

  it('centavos voltam para o campo com vírgula', () => {
    expect(centsToReaisInput(8_050)).toBe('80,50');
    expect(centsToReaisInput(29)).toBe('0,29');
  });
});
