'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Card } from '../../../../../components/ui/card';
import { cn } from '../../../../../components/ui/cn';
import { Spinner } from '../../../../../components/ui/spinner';
import { api, unwrap } from '../../../../../lib/api/client';
import { isRetryable, messageFor } from '../../../../../lib/api/errors';
import {
  type LotSales,
  SALES_PARTS,
  type SalesData,
  type SalesPart,
  toSalesView,
} from '../../../../../lib/organizer/sales';
import { myEventQueryKey, useMyEvent } from '../../../../../lib/organizer/queries';
import { useRequiredSession } from '../../../../../lib/session/use-required-session';

const PART_COLORS: Record<SalesPart, string> = {
  sold: 'bg-chart-sold',
  reserved: 'bg-chart-reserved',
  available: 'bg-line',
};

/** Vendas do evento por lote e pedidos por status (GET /events/:id/sales). */
export function SalesDashboard({ eventId }: { eventId: string }) {
  useRequiredSession();
  const event = useMyEvent(eventId);
  const sales = useQuery({
    queryKey: [...myEventQueryKey(eventId), 'sales'],
    queryFn: () => unwrap(api.GET('/events/{id}/sales', { params: { path: { id: eventId } } })),
    retry: (failures, error) => isRetryable(error) && failures < 2,
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href={`/organizador/eventos/${eventId}`} className="text-sm font-medium text-brand">
          ← {event.data?.title ?? 'Voltar ao evento'}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Vendas</h1>
          {sales.isSuccess && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted" aria-live="polite">
                Atualizado às {new Date(sales.dataUpdatedAt).toLocaleTimeString('pt-BR')}
              </span>
              <Button
                variant="secondary"
                loading={sales.isFetching}
                onClick={() => void sales.refetch()}
              >
                Atualizar
              </Button>
            </div>
          )}
        </div>
      </header>
      <SalesBody sales={sales} />
    </div>
  );
}

function SalesBody({ sales }: { sales: UseQueryResult<SalesData> }) {
  if (sales.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando as vendas" /> Carregando as vendas…
      </div>
    );
  }
  // Só a falha da primeira carga troca o painel pelo erro; a do "Atualizar" mantém os números.
  if (sales.isLoadingError) {
    return <Alert tone="error">{messageFor(sales.error)}</Alert>;
  }

  const view = toSalesView(sales.data);
  return (
    <>
      {sales.isRefetchError && <Alert tone="error">{messageFor(sales.error)}</Alert>}
      <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Receita" value={view.revenue} hint="Só pedidos pagos; reembolso sai." />
        <StatTile label="Ingressos vendidos" value={view.sold} hint="De todos os lotes." />
        <StatTile label="Reservados agora" value={view.reserved} hint="Aguardando o pagamento." />
      </section>

      <section aria-labelledby="por-lote" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="por-lote" className="text-lg font-semibold">
            Por lote
          </h2>
          <Legend />
        </div>
        {view.lots.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lote cadastrado.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {view.lots.map((lot) => (
              <li key={lot.id} className="flex flex-col gap-2 p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-semibold">{lot.name}</span>
                  <span className="font-medium tabular-nums">{lot.revenue}</span>
                </div>
                <SalesBar lot={lot} />
                <span className="text-sm text-muted">{lot.figures}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pedidos" className="flex flex-col gap-4">
        <h2 id="pedidos" className="text-lg font-semibold">
          Pedidos por status
        </h2>
        <Card className="max-w-xl p-0">
          <dl className="flex flex-col divide-y divide-line">
            {view.orders.map((order) => (
              <div key={order.status} className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-sm text-muted">{order.label}</dt>
                <dd className="font-medium tabular-nums">{order.count}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>
    </>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-muted">{hint}</span>
    </Card>
  );
}

/** Uma legenda para a lista toda: a barra de cada lote não leva texto (os números estão abaixo). */
function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {SALES_PARTS.map(({ part, label }) => (
        <li key={part} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2.5 rounded-full', PART_COLORS[part])} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Barra segmentada fina: vendidos, reservados e disponíveis, com 2px de vão entre as partes. */
function SalesBar({ lot }: { lot: LotSales }) {
  const labels = Object.fromEntries(SALES_PARTS.map(({ part, label }) => [part, label]));
  return (
    <div
      role="img"
      aria-label={lot.label}
      className="flex h-2 gap-0.5 overflow-hidden rounded-full"
    >
      {lot.parts.map(({ part, value }) => (
        <span
          key={part}
          title={`${labels[part]}: ${value.toLocaleString('pt-BR')}`}
          className={cn('h-full', PART_COLORS[part])}
          style={{ flexGrow: value }}
        />
      ))}
      {lot.rest > 0 && <span aria-hidden="true" style={{ flexGrow: lot.rest }} />}
    </div>
  );
}
