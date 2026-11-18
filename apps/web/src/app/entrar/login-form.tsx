'use client';

import { loginRequestSchema } from '@ticketflow/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Spinner } from '../../components/ui/spinner';
import { messageFor } from '../../lib/api/errors';
import { type FieldErrors, validate } from '../../lib/forms/validate';
import { safeNextPath } from '../../lib/session/route-access';
import { useLogin, useSilentRefresh } from '../../lib/session/use-session';

type LoginField = 'email' | 'password';

const MESSAGES: Record<LoginField, string> = {
  email: 'Informe um e-mail válido.',
  password: 'Informe a senha.',
};

/**
 * Login. Antes do formulário, tenta renovar a sessão com o cookie de refresh: o proxy manda
 * para cá quem chegou sem access token válido, e quem ainda tem sessão volta direto para a
 * página que pediu (ADR 0016).
 */
export function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const login = useLogin();
  const refresh = useSilentRefresh();
  const tried = useRef(false);
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({});

  const goNext = () => {
    router.replace(next);
    router.refresh();
  };

  useEffect(() => {
    if (tried.current) {
      return;
    }
    tried.current = true;
    refresh.mutate(undefined, { onSuccess: goNext });
    // Uma tentativa por visita à página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (refresh.isPending || refresh.isSuccess || refresh.isIdle) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted">
        <Spinner label="Verificando a sessão" />
        Verificando a sessão…
      </div>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(
      loginRequestSchema,
      { email: form.get('email'), password: form.get('password') },
      MESSAGES,
    );
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) {
      login.mutate(result.data, { onSuccess: goNext });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Entrar</h1>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {login.isError && <Alert tone="error">{messageFor(login.error)}</Alert>}
        <Field label="E-mail" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          error={errors.password}
        />
        <Button type="submit" loading={login.isPending}>
          Entrar
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Ainda não tem conta?{' '}
        <Link
          href={`/cadastro?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand"
        >
          Criar conta
        </Link>
      </p>
    </Card>
  );
}
