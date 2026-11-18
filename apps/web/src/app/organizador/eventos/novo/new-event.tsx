'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { EventForm } from '../../../../components/organizer/event-form';
import { Card } from '../../../../components/ui/card';
import { api, unwrap } from '../../../../lib/api/client';
import { EMPTY_EVENT, type EventBody } from '../../../../lib/organizer/events';
import { MY_EVENTS_QUERY_KEY } from '../../../../lib/organizer/queries';
import { useRequiredSession } from '../../../../lib/session/use-required-session';

/** Cria o evento como rascunho e leva à gestão dele, onde entram os lotes. */
export function NewEvent() {
  useRequiredSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const create = async (body: EventBody) => {
    const event = await unwrap(api.POST('/events', { body }));
    await queryClient.invalidateQueries({ queryKey: MY_EVENTS_QUERY_KEY });
    router.push(`/organizador/eventos/${event.id}`);
  };

  return (
    <Card>
      <EventForm
        initial={EMPTY_EVENT}
        submitLabel="Criar rascunho"
        cancelHref="/organizador"
        onSubmit={create}
      />
    </Card>
  );
}
