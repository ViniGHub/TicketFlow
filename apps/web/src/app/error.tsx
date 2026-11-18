'use client';

import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';

/** Erro inesperado numa página: mensagem curta e uma nova tentativa, sem detalhes técnicos. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <h1 className="text-2xl font-bold">Algo deu errado</h1>
      <Alert tone="error">Não foi possível carregar esta página. Tente de novo em instantes.</Alert>
      <Button onClick={reset} className="self-start">
        Tentar de novo
      </Button>
    </div>
  );
}
