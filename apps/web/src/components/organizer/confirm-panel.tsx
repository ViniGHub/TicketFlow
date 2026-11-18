'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';

import { messageFor } from '../../lib/api/errors';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';

export interface ConfirmPanelProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending: boolean;
  /** Erro da última tentativa, se houve. */
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmação de uma ação que não se desfaz, na própria página: explica o que vai acontecer e
 * pede o segundo clique. Ao abrir, o foco vai para "Voltar", o caminho seguro.
 */
export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  const titleId = useId();
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    back.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-card border border-danger bg-danger-soft p-5"
    >
      <h3 id={titleId} className="font-semibold text-danger">
        {title}
      </h3>
      <div className="flex flex-col gap-2 text-sm">{children}</div>
      {error !== null && error !== undefined && <Alert tone="error">{messageFor(error)}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={back} variant="secondary" onClick={onCancel} disabled={pending}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
