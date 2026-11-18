import { type InputHTMLAttributes, useId } from 'react';

import { cn } from './cn';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Mensagem de erro do campo; marca o input como inválido para os leitores de tela. */
  error?: string | undefined;
  hint?: string;
}

/** Rótulo, campo e mensagem, ligados por id: clicar no rótulo foca o campo. */
export function Field({ label, error, hint, id, className, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-mensagem`;
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'h-10 rounded-control border bg-surface px-3 text-sm',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
      {message && (
        <p id={messageId} className={cn('text-sm', error ? 'text-danger' : 'text-muted')}>
          {message}
        </p>
      )}
    </div>
  );
}
