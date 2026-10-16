import { DomainError } from './domain-error.js';

/** Valor monetário em centavos de BRL. Sempre inteiro e não negativo; nunca float. */
export type Cents = number;

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';

  constructor(value: number) {
    super(`Valor monetário inválido: ${value}. Use centavos inteiros e não negativos.`);
  }
}

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidMoneyError(value);
  }
  return value;
}

export function multiplyCents(unitPrice: Cents, quantity: number): Cents {
  assertCents(unitPrice);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantidade inválida: ${quantity}`);
  }
  return assertCents(unitPrice * quantity);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((total, value) => assertCents(total + assertCents(value)), 0);
}
