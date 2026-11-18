'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Alert } from '../../../components/ui/alert';
import { Button, buttonClasses } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { cn } from '../../../components/ui/cn';
import { Spinner } from '../../../components/ui/spinner';
import { api, unwrap } from '../../../lib/api/client';
import { ApiError, messageFor } from '../../../lib/api/errors';
import { formatCents } from '../../../lib/format';
import {
  checkoutReturnOf,
  orderStatusView,
  POLL_TIMEOUT_MS,
  pollInterval,
  type StatusTone,
} from '../../../lib/orders/status';

const TONE_STYLES: Record<StatusTone, string> = {
  success: 'border-success bg-success-soft text-success',
  pending: 'border-brand bg-brand-soft text-brand',
  info: 'border-line bg-surface-muted text-text',
  error: 'border-danger bg-danger-soft text-danger',
};

/**
 * Status do pedido, consultado a cada 2 s enquanto ele espera o pagamento (ADR 0017). A página
 * nunca dá o pedido como pago por conta própria: mostra o que a API gravou.
 */
export function OrderStatusPanel({ orderId }: { orderId: string }) {
  const checkout = checkoutReturnOf(useSearchParams().get('checkout'));
  const queryClient = useQueryClient();
  const [timedOut, setTimedOut] = useState(false);
  const queryKey = ['order', orderId];

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const order = useQuery({
    queryKey,
    queryFn: () => unwrap(api.GET('/orders/{id}', { params: { path: { id: orderId } } })),
    refetchInterval: (query) => pollInterval(query.state.data?.status, timedOut),
  });

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/orders/{id}/cancel', { params: { path: { id: orderId } } })),
    onSuccess: (cancelled) => queryClient.setQueryData(queryKey, cancelled),
    // O pedido mudou enquanto isso (pagamento, expiração): mostra o status atual.
    onError: () => void queryClient.invalidateQueries({ queryKey }),
  });

  if (order.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando o pedido" /> Carregando o pedido…
      </div>
    );
  }
  if (order.isError) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return (
      <Alert tone="error">{notFound ? 'Pedido não encontrado.' : messageFor(order.error)}</Alert>
    );
  }

  const { status, totalCents, items, expiresAt } = order.data;
  const view = orderStatusView(status, checkout, timedOut);
  const ticketCount = items.reduce((total, item) => total + item.quantity, 0);

  return (
    <Card className="flex flex-col gap-6">
      <div
        className={cn('flex items-start gap-3 rounded-control border p-4', TONE_STYLES[view.tone])}
      >
        {view.tone === 'pending' && <Spinner label="Aguardando" className="mt-1" />}
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{view.title}</h2>
          <p className="text-sm text-text">{view.message}</p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted">Ingressos</dt>
        <dd>{ticketCount}</dd>
        <dt className="text-muted">Total</dt>
        <dd className="font-semibold">{formatCents(totalCents)}</dd>
        {view.canCancel && (
          <>
            <dt className="text-muted">Reservado até</dt>
            <dd>
              {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(expiresAt))}
            </dd>
          </>
        )}
        <dt className="text-muted">Pedido</dt>
        <dd className="font-mono text-xs text-muted">{orderId}</dd>
      </dl>

      {cancel.isError && <Alert tone="error">{messageFor(cancel.error)}</Alert>}

      <div className="flex flex-wrap gap-3">
        {view.showTickets && (
          <Link href="/conta/ingressos" className={buttonClasses('primary')}>
            Ver meus ingressos
          </Link>
        )}
        {view.canCancel && (
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Liberar a reserva
          </Button>
        )}
        <Link href="/" className={buttonClasses('ghost')}>
          Ver outros eventos
        </Link>
      </div>
    </Card>
  );
}
