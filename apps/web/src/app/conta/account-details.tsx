'use client';

import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import { messageFor } from '../../lib/api/errors';
import { useRequiredSession } from '../../lib/session/use-required-session';

const ROLE_LABELS = { BUYER: 'Comprador', ORGANIZER: 'Organizador' } as const;

/** Os dados de /me. Os ingressos e pedidos chegam na etapa 6.2. */
export function AccountDetails() {
  const session = useRequiredSession();

  if (session.isPending || session.data === null) {
    return <Spinner label="Carregando a conta" />;
  }
  if (session.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone="error">{messageFor(session.error)}</Alert>
        <Button variant="secondary" onClick={() => void session.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  const user = session.data;
  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-muted">Nome</dt>
        <dd>{user.name}</dd>
        <dt className="text-sm text-muted">E-mail</dt>
        <dd>{user.email}</dd>
        <dt className="text-sm text-muted">Perfis</dt>
        <dd>{user.roles.map((role) => ROLE_LABELS[role]).join(' e ')}</dd>
      </dl>
    </Card>
  );
}
