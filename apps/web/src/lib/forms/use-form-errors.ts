'use client';

import { type FormEvent, useState } from 'react';

import { type FieldErrors } from './validate';

/** O primeiro campo com erro, na ordem da tela. */
export function firstInvalid<F extends string>(
  fields: readonly F[],
  errors: FieldErrors<F>,
): F | undefined {
  return fields.find((field) => errors[field]);
}

/** Os erros sem o do campo que acabou de ser editado. */
export function withoutField<F extends string>(
  errors: FieldErrors<F>,
  name: string,
): FieldErrors<F> {
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => field !== name),
  ) as FieldErrors<F>;
}

/**
 * Erros por campo de um formulário. Ao mostrar, o foco vai para o primeiro campo com erro, na
 * ordem de `fields`; ao editar um campo, o erro dele some.
 */
export function useFormErrors<F extends string>(fields: readonly F[]) {
  const [errors, setErrors] = useState<FieldErrors<F>>({});

  const show = (form: HTMLFormElement, next: FieldErrors<F>) => {
    setErrors(next);
    const first = firstInvalid(fields, next);
    const control = first ? form.elements.namedItem(first) : null;
    if (control instanceof HTMLElement) {
      control.focus();
    }
  };

  const clearOnChange = (event: FormEvent<HTMLFormElement>) => {
    const { name } = event.target as { name?: unknown };
    if (typeof name === 'string' && name in errors) {
      setErrors((current) => withoutField(current, name));
    }
  };

  return { errors, show, clearOnChange };
}
