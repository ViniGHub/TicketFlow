import { type ButtonHTMLAttributes } from 'react';

import { cn } from './cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'border border-line bg-surface text-text hover:bg-surface-muted',
  ghost: 'text-text hover:bg-surface-muted',
  danger: 'bg-danger text-on-brand hover:opacity-90',
};

/** Classes de botão, para um `<Link>` com cara de botão. */
export function buttonClasses(variant: ButtonVariant = 'primary', className?: string): string {
  return cn(
    'inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium',
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Enquanto `true`, mostra o indicador e não aceita outro clique (evita envio duplo). */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, className)}
      {...props}
    >
      {loading && <Spinner label="Enviando" />}
      {children}
    </button>
  );
}
