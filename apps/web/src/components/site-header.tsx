'use client';

import { type MeResponse } from '@ticketflow/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useLogout, useSession } from '../lib/session/use-session';
import { useHydrated } from '../lib/use-hydrated';

import { Button, buttonClasses } from './ui/button';

/** Cabeçalho do site: a sessão vem de /me, nunca de localStorage (ADR 0016). */
export function SiteHeader() {
  const session = useSession();
  const logout = useLogout();
  const router = useRouter();
  // Até hidratar, o cabeçalho é o mesmo do servidor, que não conhece a sessão.
  const hydrated = useHydrated();

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
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Ticket<span className="text-brand">Flow</span>
          </Link>
          <Link href="/" className="hidden text-sm text-muted hover:text-text sm:inline">
            Eventos
          </Link>
        </div>
        <AccountNav
          pending={!hydrated || session.isPending}
          user={session.data ?? null}
          signingOut={logout.isPending}
          onSignOut={signOut}
        />
      </div>
    </header>
  );
}

interface AccountNavProps {
  pending: boolean;
  user: MeResponse | null;
  signingOut: boolean;
  onSignOut: () => void;
}

/** A parte do cabeçalho que depende da sessão. */
export function AccountNav({ pending, user, signingOut, onSignOut }: AccountNavProps) {
  return (
    <nav aria-label="Conta" className="flex items-center gap-2">
      {pending ? (
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
          {user.roles.includes('BUYER') && (
            <Link href="/conta/ingressos" className={buttonClasses('ghost')}>
              Meus ingressos
            </Link>
          )}
          <Link href="/conta" className={buttonClasses('ghost')}>
            {user.name}
          </Link>
          <Button variant="secondary" loading={signingOut} onClick={onSignOut}>
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
  );
}
