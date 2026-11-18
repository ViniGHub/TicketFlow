'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { loginUrlFor } from './route-access';
import { useSession } from './use-session';

/**
 * Sessão de uma página protegida. O proxy já barrou quem chegou sem access token; isto cobre a
 * sessão que acabou com a página aberta (a renovação falhou): volta para o login.
 */
export function useRequiredSession() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const lost = session.isSuccess && session.data === null;

  useEffect(() => {
    if (lost) {
      router.replace(loginUrlFor(pathname));
    }
  }, [lost, pathname, router]);

  return session;
}
