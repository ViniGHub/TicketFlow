/**
 * Ordem de ids em minúsculas, a mesma do tipo `uuid` do Postgres. Toda trava ou reserva em
 * vários lotes segue esta ordem, para duas transações nunca se travarem em ordens opostas.
 */
export function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
