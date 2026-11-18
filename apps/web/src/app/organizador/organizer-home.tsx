'use client';

import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import { useRequiredSession } from '../../lib/session/use-required-session';

/** Início da área do organizador. Eventos, vendas e check-in chegam na etapa 6.3. */
export function OrganizerHome() {
  const session = useRequiredSession();

  if (!session.data) {
    return <Spinner label="Carregando a área do organizador" />;
  }
  return (
    <Card className="flex flex-col gap-2">
      <p>Olá, {session.data.name}.</p>
      <p className="text-sm text-muted">
        Aqui vão ficar os seus eventos, as vendas de cada lote e o check-in.
      </p>
    </Card>
  );
}
