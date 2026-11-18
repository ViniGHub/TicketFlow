'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useLogout, useSession } from '../lib/session/use-session';

import { Button, buttonClasses } from './ui/button';

/** Cabeçalho do site: a sessão vem de /me, nunca de localStorage (ADR 0016). */
export function SiteHeader() {
  const session = useSession();
  const logout = useLogout();
  const router = useRouter();
  const user = session.data;

  const signOut = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        router.push('/');
        router.refresh();
      },
    });
  };

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Ticket<span className="text-brand">Flow</span>
        </Link>
        <nav aria-label="Conta" className="flex items-center gap-2">
          {session.isPending ? (
            <span
              aria-hidden="true"
              className="h-10 w-40 animate-pulse rounded-control bg-surface-muted"
            />
          ) : user ? (
            <>
              {user.roles.includes('ORGANIZER') && (
                <Link href="/organizador" className={buttonClasses('ghost')}>
                  Área do organizador
                </Link>
              )}
              <Link href="/conta" className={buttonClasses('ghost')}>
                {user.name}
              </Link>
              <Button variant="secondary" loading={logout.isPending} onClick={signOut}>
                Sair
              </Button>
            </>
          ) : (
            <>
              <Link href="/entrar" className={buttonClasses('ghost')}>
                Entrar
              </Link>
              <Link href="/cadastro" className={buttonClasses('primary')}>
                Criar conta
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
