'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { EventForm } from '../../../../../components/organizer/event-form';
import { Alert } from '../../../../../components/ui/alert';
import { buttonClasses } from '../../../../../components/ui/button';
import { Card } from '../../../../../components/ui/card';
import { Spinner } from '../../../../../components/ui/spinner';
import { api, unwrap } from '../../../../../lib/api/client';
import { messageFor } from '../../../../../lib/api/errors';
import { type EventBody, eventFormValuesOf, eventPatch } from '../../../../../lib/organizer/events';
import {
  MY_EVENTS_QUERY_KEY,
  myEventQueryKey,
  useMyEvent,
} from '../../../../../lib/organizer/queries';
import { useRequiredSession } from '../../../../../lib/session/use-required-session';

/** Edita os dados do evento; o PATCH leva só o que mudou. Evento cancelado não se edita. */
export function EditEvent({ eventId }: { eventId: string }) {
  useRequiredSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const event = useMyEvent(eventId);
  const back = `/organizador/eventos/${eventId}`;

  if (event.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando o evento" /> Carregando o evento…
      </div>
    );
  }
  if (event.isError || event.data.status === 'CANCELLED') {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone="error">
          {event.isError ? messageFor(event.error) : 'Evento cancelado não pode ser alterado.'}
        </Alert>
        <Link href={event.isError ? '/organizador' : back} className={buttonClasses('secondary')}>
          Voltar
        </Link>
      </div>
    );
  }

  const original = event.data;
  const save = async (body: EventBody) => {
    const patch = eventPatch(original, body);
    if (Object.keys(patch).length > 0) {
      const updated = await unwrap(
        api.PATCH('/events/{id}', { params: { path: { id: eventId } }, body: patch }),
      );
      queryClient.setQueryData(myEventQueryKey(eventId), updated);
      await queryClient.invalidateQueries({ queryKey: MY_EVENTS_QUERY_KEY, exact: true });
    }
    router.push(back);
  };

  return (
    <Card>
      <EventForm
        initial={eventFormValuesOf(original)}
        submitLabel="Salvar alterações"
        cancelHref={back}
        onSubmit={save}
      />
    </Card>
  );
}
