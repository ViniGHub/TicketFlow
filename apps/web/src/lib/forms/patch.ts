// Corpo de um PATCH: só o que mudou (ROADMAP, etapa 6.3). Reenviar um campo igual não é
// neutro na API: a data de um evento que já passou seria validada de novo e recusada.

/**
 * Os campos de `next` diferentes do `original`. Datas (em `dateKeys`) são comparadas pelo
 * instante, não pelo texto: `23:00:00Z` e `23:00:00.000Z` são a mesma hora.
 */
export function changedFields<T extends object>(
  original: { [K in keyof T]: unknown },
  next: T,
  dateKeys: readonly (keyof T)[] = [],
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    const same = dateKeys.includes(key)
      ? Date.parse(String(original[key])) === Date.parse(String(next[key]))
      : original[key] === next[key];
    if (!same) {
      patch[key] = next[key];
    }
  }
  return patch;
}
