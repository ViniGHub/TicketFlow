'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api, unwrap } from '../../lib/api/client';
import { messageFor } from '../../lib/api/errors';
import { type EventCardView, toEventCard } from '../../lib/catalog/view';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';

import { EventCard } from './event-card';

interface CatalogPage {
  items: EventCardView[];
  nextCursor: string | null;
}

/**
 * Grade do catálogo. A primeira página vem do servidor, já formatada; as seguintes, do
 * navegador, pelo cursor (ADR 0004).
 */
export function EventGrid({ firstPage }: { firstPage: CatalogPage }) {
  const catalog = useInfiniteQuery({
    queryKey: ['catalog'],
    queryFn: async ({ pageParam }): Promise<CatalogPage> => {
      const page = await unwrap(api.GET('/events', { params: { query: { cursor: pageParam } } }));
      return { items: page.items.map(toEventCard), nextCursor: page.nextCursor };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialData: { pages: [firstPage], pageParams: [undefined] },
    staleTime: 60_000,
  });

  const events = catalog.data.pages.flatMap((page) => page.items);
  if (events.length === 0) {
    return <p className="text-muted">Nenhum evento à venda agora. Volte em breve.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <li key={event.id} className="flex">
            <EventCard event={event} />
          </li>
        ))}
      </ul>
      {catalog.isFetchNextPageError && <Alert tone="error">{messageFor(catalog.error)}</Alert>}
      {catalog.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={catalog.isFetchingNextPage}
          onClick={() => void catalog.fetchNextPage()}
        >
          Carregar mais eventos
        </Button>
      )}
    </div>
  );
}
