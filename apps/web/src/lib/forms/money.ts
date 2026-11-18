// Preço digitado em reais, guardado em centavos (CLAUDE.md, regra 2; ADR 0018). A conversão lê
// o texto: nada de multiplicar um decimal por 100, que erra em valores como 0,29.

const PLAIN = /^(\d+)(?:,(\d{1,2}))?$/;
const GROUPED = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;

/**
 * "80", "80,5", "1.234,56" ou "R$ 80,00" em centavos. Ponto só vale como separador de milhar
 * (em grupos de três): "80.5" é ambíguo e é recusado. Fora do formato: `null`.
 */
export function parseReais(text: string): number | null {
  const value = text.replace(/^R\$\s*/i, '').trim();
  const match = PLAIN.exec(value) ?? GROUPED.exec(value);
  if (!match) {
    return null;
  }
  const [, integer = '', fraction = ''] = match;
  const reais = Number(integer.replaceAll('.', ''));
  const cents = Number(fraction.padEnd(2, '0'));
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Centavos para o campo de edição, sem o símbolo: 8000 vira "80,00". */
export function centsToReaisInput(cents: number): string {
  const reais = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${reais},${rest}`;
}
