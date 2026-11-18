import { type Metadata } from 'next';

import { Card } from '../../../components/ui/card';
import { type LotView, toLotView } from '../../../lib/catalog/view';
import { formatEventDate } from '../../../lib/format';

import { loadEvent } from './event-data';

// Estoque e janela de vendas mudam a todo momento: renderizado a cada visita.
export const dynamic = 'force-dynamic';

interface EventPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const event = await loadEvent((await params).id);
  return { title: event.title, description: `${event.title} · ${event.venue}` };
}

export default async function EventPage({ params }: EventPageProps) {
  const event = await loadEvent((await params).id);
  const now = new Date();
  const lots = event.ticketTypes.map((lot) => toLotView(lot, now, event.timezone));

  return (
    <article className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-brand">
          {formatEventDate(event.startsAt, event.timezone)}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{event.title}</h1>
        <p className="text-muted">{event.venue}</p>
        {event.description && (
          <p className="max-w-prose whitespace-pre-line leading-relaxed">{event.description}</p>
        )}
      </div>
      <Card className="flex flex-col gap-4 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">Ingressos</h2>
        <LotList lots={lots} />
      </Card>
    </article>
  );
}

function LotList({ lots }: { lots: LotView[] }) {
  if (lots.length === 0) {
    return <p className="text-sm text-muted">Os ingressos ainda não estão à venda.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {lots.map((lot) => (
        <li key={lot.id} className="flex items-center justify-between gap-4 py-3">
          <div className="flex flex-col">
            <span className="font-medium">{lot.name}</span>
            <span className="text-sm text-muted">{lot.priceLabel}</span>
          </div>
          <LotStatus lot={lot} />
        </li>
      ))}
    </ul>
  );
}

function LotStatus({ lot }: { lot: LotView }) {
  switch (lot.state.type) {
    case 'on-sale':
      return <span className="text-sm text-success">À venda</span>;
    case 'sold-out':
      return <span className="text-sm font-medium text-danger">Esgotado</span>;
    case 'ended':
      return <span className="text-sm text-muted">Vendas encerradas</span>;
    case 'not-started':
      return <span className="max-w-40 text-right text-sm text-muted">{lot.state.label}</span>;
  }
}
