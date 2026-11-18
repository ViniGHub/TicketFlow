import { type ReactNode } from 'react';

import { cn } from './cn';

export type BadgeTone = 'success' | 'muted' | 'danger' | 'brand';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success',
  muted: 'bg-surface-muted text-muted',
  danger: 'bg-danger-soft text-danger',
  brand: 'bg-brand-soft text-brand',
};

/** Selo de status, como "Publicado" ou "Rascunho". */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone])}>
      {children}
    </span>
  );
}
