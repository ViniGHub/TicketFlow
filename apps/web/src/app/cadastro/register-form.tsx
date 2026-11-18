'use client';

import { type Role, registerRequestSchema } from '@ticketflow/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { messageFor } from '../../lib/api/errors';
import { type FieldErrors, fieldErrorsFromApi, validate } from '../../lib/forms/validate';
import { safeNextPath } from '../../lib/session/route-access';
import { useRegister } from '../../lib/session/use-session';

type RegisterField = 'name' | 'email' | 'password';

export const REGISTER_MESSAGES: Record<RegisterField, string> = {
  name: 'Informe o seu nome.',
  email: 'Informe um e-mail válido.',
  password: 'A senha precisa ter de 8 a 128 caracteres.',
};

/** Valores do formulário de cadastro, como a API recebe. */
export function registerValuesOf(form: FormData) {
  const roles: Role[] = form.get('organizer') === 'on' ? ['BUYER', 'ORGANIZER'] : ['BUYER'];
  return {
    name: form.get('name'),
    email: form.get('email'),
    password: form.get('password'),
    roles,
  };
}

/** Cadastro: a API já devolve a sessão aberta, então o usuário segue logado. */
export function RegisterForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const register = useRegister();
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(
      registerRequestSchema,
      registerValuesOf(new FormData(event.currentTarget)),
      {
        ...REGISTER_MESSAGES,
        roles: 'Escolha como vai usar o TicketFlow.',
      },
    );
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) {
      register.mutate(result.data, {
        onSuccess: () => {
          router.replace(next);
          router.refresh();
        },
        onError: (error) => setErrors(fieldErrorsFromApi(error, REGISTER_MESSAGES)),
      });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Criar conta</h1>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {register.isError && <Alert tone="error">{messageFor(register.error)}</Alert>}
        <Field label="Nome" name="name" autoComplete="name" error={errors.name} />
        <Field label="E-mail" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="De 8 a 128 caracteres."
          error={errors.password}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="organizer" className="size-4 accent-brand" />
          Também quero organizar eventos
        </label>
        <Button type="submit" loading={register.isPending}>
          Criar conta
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Já tem conta?{' '}
        <Link href={`/entrar?next=${encodeURIComponent(next)}`} className="font-medium text-brand">
          Entrar
        </Link>
      </p>
    </Card>
  );
}
