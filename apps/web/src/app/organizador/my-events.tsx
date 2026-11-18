'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button, buttonClasses } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { api, unwrap } from '../../lib/api/client';
import { messageFor } from '../../lib/api/errors';
import { formatEventDateShort } from '../../lib/format';
import { EVENT_STATUS } from '../../lib/organizer/events';
import { useRequiredSession } from '../../lib/session/use-required-session';

export const MY_EVENTS_QUERY_KEY = ['my-events'] as const;

/** Os eventos do organizador em qualquer status, pelo cursor de GET /me/events. */
export function MyEvents() {
  useRequiredSession();
  const events = useInfiniteQuery({
    queryKey: MY_EVENTS_QUERY_KEY,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET('/me/events', { params: { query: { cursor: pageParam } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (events.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando os eventos" /> Carregando os eventos…
      </div>
    );
  }
  if (events.isLoadingError) {
    return <Alert tone="error">{messageFor(events.error)}</Alert>;
  }

  const items = events.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-8">
        <p className="font-medium">Você ainda não criou nenhum evento.</p>
        <p className="text-sm text-muted">
          O evento nasce como rascunho: cadastre os lotes e publique quando estiver pronto.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {items.map((event) => {
          const status = EVENT_STATUS[event.status];
          return (
            <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:p-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{event.title}</span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <span className="text-sm text-muted">
                  {formatEventDateShort(event.startsAt, event.timezone)} · {event.venue}
                </span>
              </div>
              <Link
                href={`/organizador/eventos/${event.id}`}
                className={buttonClasses('secondary')}
              >
                Gerenciar
              </Link>
            </li>
          );
        })}
      </ul>
      {events.isFetchNextPageError && <Alert tone="error">{messageFor(events.error)}</Alert>}
      {events.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          Carregar mais eventos
        </Button>
      )}
    </div>
  );
}
