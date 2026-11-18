import { ApiError, messageFor } from '../api/errors';

// Validação dos formulários com os mesmos schemas zod da API (packages/contracts), com as
// mensagens em português do próprio formulário.

/** O que o formulário usa de um schema zod. */
interface Schema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };
}

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export type Validation<T, F extends string> =
  { ok: true; data: T } | { ok: false; errors: FieldErrors<F> };

/** Valida os valores; cada campo com problema recebe a mensagem dele em `messages`. */
export function validate<T, F extends string>(
  schema: Schema<T>,
  values: Record<F, unknown>,
  messages: Record<F, string>,
): Validation<T, F> {
  const result = schema.safeParse(values);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: fieldErrorsOf(result.error.issues, messages) };
}

/**
 * Os campos que a API recusou, com as mensagens do formulário: os de um 400 (validação) e,
 * em `codeFields`, os erros de domínio que dizem respeito a um campo só (ex.: `EVENT_IN_PAST`
 * na data do evento), com a mensagem da API.
 */
export function fieldErrorsFromApi<F extends string>(
  error: unknown,
  messages: Record<F, string>,
  codeFields: Readonly<Partial<Record<string, F>>> = {},
): FieldErrors<F> {
  if (!(error instanceof ApiError)) {
    return {};
  }
  const field = codeFields[error.code];
  if (field) {
    return { [field]: messageFor(error) } as FieldErrors<F>;
  }
  if (error.code !== 'BAD_REQUEST') {
    return {};
  }
  return fieldErrorsOf(
    error.issues.map((issue) => ({ path: issue.path.split('.') })),
    messages,
  );
}

function fieldErrorsOf<F extends string>(
  issues: readonly { path: readonly PropertyKey[] }[],
  messages: Record<F, string>,
): FieldErrors<F> {
  const errors: FieldErrors<F> = {};
  for (const { path } of issues) {
    const field = path[0];
    if (typeof field === 'string' && field in messages) {
      errors[field as F] = messages[field as F];
    }
  }
  return errors;
}
