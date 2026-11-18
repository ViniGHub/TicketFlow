'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { api, unwrap } from '../../lib/api/client';
import { ApiError, messageFor } from '../../lib/api/errors';
import { type LotView } from '../../lib/catalog/view';
import {
  type Attempt,
  attemptFor,
  keepsAttemptAfter,
  type OrderItem,
  orderItems,
  type Selection,
  selectionTotal,
  setQuantity,
  tooManyLots,
} from '../../lib/checkout/selection';
import { formatCents } from '../../lib/format';
import { loginUrlFor } from '../../lib/session/route-access';
import { useSession } from '../../lib/session/use-session';
import { useHydrated } from '../../lib/use-hydrated';
import { Alert } from '../ui/alert';
import { Button, buttonClasses } from '../ui/button';

import { QuantityStepper } from './quantity-stepper';

/** Erros em que a disponibilidade mudou: a página busca o evento de novo. */
const STALE_CATALOG = new Set([
  'INSUFFICIENT_STOCK',
  'SALES_WINDOW_CLOSED',
  'EVENT_NOT_PUBLISHED',
  'TICKET_TYPE_NOT_FOUND',
]);

interface Purchase {
  items: OrderItem[];
  idempotencyKey: string;
}

/**
 * Escolha de ingressos e compra (ROADMAP, etapa 6.2; ADR 0017). A compra cria o pedido com uma
 * `Idempotency-Key` por tentativa e leva o comprador à página de pagamento do Stripe; quem diz
 * se o pedido foi pago é o webhook, nunca esta página.
 */
export function TicketPicker({ eventId, lots }: { eventId: string; lots: LotView[] }) {
  const router = useRouter();
  const session = useSession();
  const hydrated = useHydrated();
  const [selection, setSelection] = useState<Selection>({});
  const attempt = useRef<Attempt | null>(null);
  const items = orderItems(selection);
  const eventPath = `/eventos/${eventId}`;

  const purchase = useMutation({
    mutationFn: ({ items: body, idempotencyKey }: Purchase) =>
      unwrap(
        api.POST('/orders', {
          body: { items: body },
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      ),
    onSuccess: (order) => {
      // Sem página de pagamento (replay de pedido que não pode mais ser pago): o pedido mostra
      // o que aconteceu.
      if (order.checkoutUrl) {
        window.location.assign(order.checkoutUrl);
      } else {
        router.push(`/pedidos/${order.id}`);
      }
    },
    onError: (error) => {
      if (!keepsAttemptAfter(error)) {
        attempt.current = null;
      }
      if (error instanceof ApiError && error.status === 401) {
        router.push(loginUrlFor(eventPath));
      } else if (error instanceof ApiError && STALE_CATALOG.has(error.code)) {
        router.refresh();
      }
    },
  });

  const buy = () => {
    attempt.current = attemptFor(attempt.current, items, () => crypto.randomUUID());
    purchase.mutate({ items, idempotencyKey: attempt.current.idempotencyKey });
  };

  const onSale = lots.some((lot) => lot.state.type === 'on-sale');
  // A sessão só muda a tela depois da hidratação: no servidor ela ainda não existe.
  const user = hydrated && session.isSuccess ? session.data : undefined;
  const anonymous = user === null;
  const notBuyer = user ? !user.roles.includes('BUYER') : false;
  const redirecting = purchase.isSuccess;

  if (lots.length === 0) {
    return <p className="text-sm text-muted">Os ingressos ainda não estão à venda.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line">
        {lots.map((lot) => (
          <li key={lot.id} className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col">
              <span className="font-medium">{lot.name}</span>
              <span className="text-sm text-muted">{lot.priceLabel}</span>
            </div>
            {lot.state.type === 'on-sale' ? (
              <QuantityStepper
                label={lot.name}
                value={selection[lot.id] ?? 0}
                max={lot.state.maxQuantity}
                disabled={purchase.isPending || redirecting}
                onChange={(quantity) =>
                  setSelection((current) =>
                    setQuantity(
                      current,
                      lot.id,
                      quantity,
                      lot.state.type === 'on-sale' ? lot.state.maxQuantity : 0,
                    ),
                  )
                }
              />
            ) : (
              <LotStatus state={lot.state} />
            )}
          </li>
        ))}
      </ul>

      {onSale && (
        <>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total</span>
            <span className="text-xl font-bold tabular-nums">
              {items.length > 0 ? formatCents(selectionTotal(selection, lots)) : '—'}
            </span>
          </div>
          {purchase.isError &&
            !(purchase.error instanceof ApiError && purchase.error.status === 401) && (
              <Alert tone="error">{messageFor(purchase.error)}</Alert>
            )}
          {tooManyLots(items) && (
            <Alert tone="error">Escolha no máximo 10 lotes diferentes por pedido.</Alert>
          )}
          {notBuyer && (
            <Alert>
              Sua conta é só de organizador. Para comprar, entre com uma conta de comprador.
            </Alert>
          )}
          {anonymous ? (
            <Link href={loginUrlFor(eventPath)} className={buttonClasses('primary')}>
              Entrar para comprar
            </Link>
          ) : (
            <Button
              onClick={buy}
              loading={purchase.isPending || redirecting}
              disabled={items.length === 0 || tooManyLots(items) || notBuyer}
            >
              {redirecting ? 'Indo para o pagamento…' : 'Comprar'}
            </Button>
          )}
          <p className="text-xs text-muted">
            Os ingressos ficam reservados por 30 minutos enquanto você paga no Stripe.
          </p>
        </>
      )}
    </div>
  );
}

function LotStatus({ state }: { state: LotView['state'] }) {
  switch (state.type) {
    case 'sold-out':
      return <span className="text-sm font-medium text-danger">Esgotado</span>;
    case 'ended':
      return <span className="text-sm text-muted">Vendas encerradas</span>;
    case 'not-started':
      return <span className="text-right text-sm text-muted">{state.label}</span>;
    default:
      return null;
  }
}
