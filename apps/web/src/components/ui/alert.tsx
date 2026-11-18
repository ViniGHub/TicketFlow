import { type ReactNode } from 'react';

import { cn } from './cn';

type AlertTone = 'error' | 'success' | 'info';

const TONES: Record<AlertTone, string> = {
  error: 'border-danger bg-danger-soft text-danger',
  success: 'border-success bg-success-soft text-success',
  info: 'border-line bg-surface-muted text-text',
};

/** Mensagem em destaque. Erro usa `role="alert"`: o leitor de tela anuncia na hora. */
export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-control border px-4 py-3 text-sm', TONES[tone])}
    >
      {children}
    </div>
  );
}
