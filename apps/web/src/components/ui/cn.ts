/** Junta classes, ignorando as falsas: `cn('a', cond && 'b')`. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
