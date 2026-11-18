'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { TicketCard } from '../../../components/tickets/ticket-card';
import { Alert } from '../../../components/ui/alert';
import { Button, buttonClasses } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { api, unwrap } from '../../../lib/api/client';
import { messageFor } from '../../../lib/api/errors';
import { useRequiredSession } from '../../../lib/session/use-required-session';
import { toTicketView } from '../../../lib/tickets/view';

/** Os ingressos do comprador, os mais novos primeiro, pelo cursor de GET /me/tickets. */
export function TicketList() {
  useRequiredSession();
  const tickets = useInfiniteQuery({
    queryKey: ['my-tickets'],
    queryFn: async ({ pageParam }) => {
      const page = await unwrap(
        api.GET('/me/tickets', { params: { query: { cursor: pageParam } } }),
      );
      return { items: page.items.map(toTicketView), nextCursor: page.nextCursor };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (tickets.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando os ingressos" /> Carregando os ingressos…
      </div>
    );
  }
  // Só a falha da primeira carga troca a lista pelo erro: a do "carregar mais" também liga o
  // isError, mas a lista já carregada continua na tela.
  if (tickets.isLoadingError) {
    return <Alert tone="error">{messageFor(tickets.error)}</Alert>;
  }

  const items = tickets.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">Você ainda não tem ingressos.</p>
        <Link href="/" className={buttonClasses('primary')}>
          Ver eventos
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
      {tickets.isFetchNextPageError && <Alert tone="error">{messageFor(tickets.error)}</Alert>}
      {tickets.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={tickets.isFetchingNextPage}
          onClick={() => void tickets.fetchNextPage()}
        >
          Carregar mais ingressos
        </Button>
      )}
    </div>
  );
}
