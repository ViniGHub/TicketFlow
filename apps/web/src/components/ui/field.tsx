import {
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

import { cn } from './cn';

interface FieldBase {
  label: string;
  /** Mensagem de erro do campo; marca o campo como inválido para os leitores de tela. */
  error?: string | undefined;
  hint?: string;
}

const CONTROL =
  'rounded-control border bg-surface px-3 text-sm focus-visible:outline-2 ' +
  'focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-60';

/** Rótulo, controle e mensagem, ligados por id: clicar no rótulo foca o campo. */
function FieldShell({
  label,
  error,
  hint,
  id,
  children,
}: FieldBase & { id?: string | undefined; children: (props: ControlProps) => ReactNode }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const messageId = `${controlId}-mensagem`;
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
        className: cn(CONTROL, error ? 'border-danger' : 'border-line'),
      })}
      {message && (
        <p id={messageId} className={cn('text-sm', error ? 'text-danger' : 'text-muted')}>
          {message}
        </p>
      )}
    </div>
  );
}

interface ControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  className: string;
}

export type FieldProps = FieldBase &
  InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };

export function Field({ label, error, hint, id, className, ...props }: FieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      {(control) => (
        <input {...control} {...props} className={cn(control.className, 'h-10', className)} />
      )}
    </FieldShell>
  );
}

export type TextAreaFieldProps = FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaField({ label, error, hint, id, className, ...props }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      {(control) => (
        <textarea
          {...control}
          {...props}
          className={cn(control.className, 'min-h-28 py-2', className)}
        />
      )}
    </FieldShell>
  );
}

export type SelectFieldProps = FieldBase &
  SelectHTMLAttributes<HTMLSelectElement> & { options: readonly { id: string; label: string }[] };

export function SelectField({
  label,
  error,
  hint,
  id,
  className,
  options,
  ...props
}: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      {(control) => (
        <select {...control} {...props} className={cn(control.className, 'h-10', className)}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}
