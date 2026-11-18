'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '../api/client';
import { isRetryable } from '../api/errors';

// Consultas da área do organizador (ROADMAP, etapa 6.3).

export const MY_EVENTS_QUERY_KEY = ['my-events'] as const;

export const myEventQueryKey = (eventId: string) => ['my-events', eventId] as const;

/** Um evento do organizador, em qualquer status, com os lotes (GET /me/events/:id). */
export function useMyEvent(eventId: string) {
  return useQuery({
    queryKey: myEventQueryKey(eventId),
    queryFn: () => unwrap(api.GET('/me/events/{id}', { params: { path: { id: eventId } } })),
    retry: (failures, error) => isRetryable(error) && failures < 2,
  });
}

export type MyEvent = NonNullable<ReturnType<typeof useMyEvent>['data']>;
export type MyLot = MyEvent['ticketTypes'][number];
