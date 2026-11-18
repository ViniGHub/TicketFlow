'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

import { ConfirmPanel } from '../../../../components/organizer/confirm-panel';
import { LotForm } from '../../../../components/organizer/lot-form';
import { Alert } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button, buttonClasses } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Spinner } from '../../../../components/ui/spinner';
import { api, unwrap } from '../../../../lib/api/client';
import { messageFor } from '../../../../lib/api/errors';
import { formatEventDate } from '../../../../lib/format';
import { EVENT_STATUS } from '../../../../lib/organizer/events';
import {
  type LotBody,
  lotFormValuesOf,
  lotPatch,
  newLotValues,
  toLotSummary,
} from '../../../../lib/organizer/lots';
import {
  MY_EVENTS_QUERY_KEY,
  type MyEvent,
  type MyLot,
  myEventQueryKey,
  useMyEvent,
} from '../../../../lib/organizer/queries';
import { useRequiredSession } from '../../../../lib/session/use-required-session';

/** Gestão de um evento: status, lotes e as ações que cabem em cada status (ROADMAP, etapa 6.3). */
export function ManageEvent({ eventId }: { eventId: string }) {
  useRequiredSession();
  const event = useMyEvent(eventId);

  if (event.isPending) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted">
        <Spinner label="Carregando o evento" /> Carregando o evento…
      </div>
    );
  }
  if (event.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone="error">{messageFor(event.error)}</Alert>
        <Link href="/organizador" className={buttonClasses('secondary')}>
          Voltar aos meus eventos
        </Link>
      </div>
    );
  }
  return <EventManager event={event.data} />;
}

function EventManager({ event }: { event: MyEvent }) {
  const status = EVENT_STATUS[event.status];
  const editable = event.status !== 'CANCELLED';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/organizador" className="text-sm font-medium text-brand">
          ← Meus eventos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-muted">
          {formatEventDate(event.startsAt, event.timezone)} · {event.venue}
        </p>
        <EventActions event={event} />
      </header>
      <LotsSection event={event} editable={editable} />
      {event.status === 'DRAFT' && <DeleteDraft event={event} />}
      {event.status === 'PUBLISHED' && <CancelEvent event={event} />}
    </div>
  );
}

/** Atualiza o evento na tela com a resposta da API e marca a lista como velha. */
function useEventUpdater() {
  const queryClient = useQueryClient();
  return async (updated: MyEvent) => {
    queryClient.setQueryData(myEventQueryKey(updated.id), updated);
    await queryClient.invalidateQueries({ queryKey: MY_EVENTS_QUERY_KEY, exact: true });
  };
}

function EventActions({ event }: { event: MyEvent }) {
  const onUpdated = useEventUpdater();
  const publish = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/events/{id}/publish', { params: { path: { id: event.id } } })),
    onSuccess: onUpdated,
  });
  const base = `/organizador/eventos/${event.id}`;

  if (event.status === 'CANCELLED') {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert>
          Evento cancelado. Os pedidos pagos foram enviados para reembolso, os ingressos foram
          anulados e os compradores receberam um e-mail.
        </Alert>
        <Link href={`${base}/vendas`} className={buttonClasses('secondary')}>
          Ver vendas
        </Link>
      </div>
    );
  }

  if (event.status === 'DRAFT') {
    const withoutLots = event.ticketTypes.length === 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            loading={publish.isPending}
            disabled={withoutLots}
            onClick={() => publish.mutate()}
          >
            Publicar
          </Button>
          <Link href={`${base}/editar`} className={buttonClasses('secondary')}>
            Editar dados
          </Link>
          <span className="text-sm text-muted">
            {withoutLots
              ? 'Cadastre ao menos um lote para publicar.'
              : 'Ao publicar, o evento entra no catálogo e cada lote vende na própria janela.'}
          </span>
        </div>
        {publish.isError && <Alert tone="error">{messageFor(publish.error)}</Alert>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`${base}/vendas`} className={buttonClasses('primary')}>
        Vendas
      </Link>
      <Link href={`${base}/check-in`} className={buttonClasses('secondary')}>
        Check-in
      </Link>
      <Link href={`${base}/editar`} className={buttonClasses('secondary')}>
        Editar dados
      </Link>
      <Link href={`/eventos/${event.id}`} className={buttonClasses('ghost')}>
        Ver página pública
      </Link>
    </div>
  );
}

function LotsSection({ event, editable }: { event: MyEvent; editable: boolean }) {
  const queryClient = useQueryClient();
  // Um formulário aberto por vez: o do lote novo ou o de um lote existente.
  const [open, setOpen] = useState<'new' | string | null>(null);

  const saved = async () => {
    await queryClient.invalidateQueries({ queryKey: myEventQueryKey(event.id) });
    setOpen(null);
  };

  const create = async (body: LotBody) => {
    await unwrap(
      api.POST('/events/{id}/ticket-types', { params: { path: { id: event.id } }, body }),
    );
    await saved();
  };

  const update = async (lot: MyLot, body: LotBody) => {
    const patch = lotPatch(lot, body);
    if (Object.keys(patch).length > 0) {
      await unwrap(
        api.PATCH('/events/{id}/ticket-types/{ticketTypeId}', {
          params: { path: { id: event.id, ticketTypeId: lot.id } },
          body: patch,
        }),
      );
    }
    await saved();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="lotes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="lotes" className="text-lg font-semibold">
          Lotes
        </h2>
        {editable && open === null && (
          <Button variant="secondary" onClick={() => setOpen('new')}>
            Adicionar lote
          </Button>
        )}
      </div>

      {open === 'new' && (
        <Card>
          <LotForm
            initial={newLotValues(event, new Date())}
            timeZone={event.timezone}
            submitLabel="Adicionar lote"
            onSubmit={create}
            onCancel={() => setOpen(null)}
          />
        </Card>
      )}

      {event.ticketTypes.length === 0 && open !== 'new' && (
        <p className="rounded-card border border-dashed border-line p-6 text-sm text-muted">
          Nenhum lote ainda. Cada lote tem preço, quantidade e a própria janela de vendas.
        </p>
      )}

      {event.ticketTypes.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {event.ticketTypes.map((lot) => (
            <li key={lot.id} className="p-4 sm:p-5">
              {open === lot.id ? (
                <LotForm
                  initial={lotFormValuesOf(lot, event.timezone)}
                  timeZone={event.timezone}
                  submitLabel="Salvar lote"
                  onSubmit={(body) => update(lot, body)}
                  onCancel={() => setOpen(null)}
                />
              ) : (
                <LotRow
                  lot={lot}
                  timeZone={event.timezone}
                  onEdit={editable && open === null ? () => setOpen(lot.id) : undefined}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LotRow({
  lot,
  timeZone,
  onEdit,
}: {
  lot: MyLot;
  timeZone: string;
  onEdit: (() => void) | undefined;
}) {
  const summary = toLotSummary(lot, timeZone);
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-semibold">{lot.name}</span>
          <span className="font-medium text-brand">{summary.price}</span>
        </div>
        <span className="text-sm text-muted">
          {summary.stock} · {summary.maxPerOrder}
        </span>
        <span className="text-sm text-muted">{summary.window}</span>
      </div>
      {onEdit && (
        <Button variant="secondary" onClick={onEdit} aria-label={`Editar o lote ${lot.name}`}>
          Editar
        </Button>
      )}
    </div>
  );
}

function DeleteDraft({ event }: { event: MyEvent }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/events/{id}', { params: { path: { id: event.id } } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: myEventQueryKey(event.id) });
      await queryClient.invalidateQueries({ queryKey: MY_EVENTS_QUERY_KEY, exact: true });
      router.push('/organizador');
    },
  });

  return (
    <DangerZone>
      {confirming ? (
        <ConfirmPanel
          title="Excluir este rascunho?"
          confirmLabel="Sim, excluir rascunho"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>O evento e os lotes dele somem. Não dá para desfazer.</p>
        </ConfirmPanel>
      ) : (
        <DangerAction
          text="Excluir o rascunho apaga o evento e os lotes. Só rascunhos podem ser excluídos."
          label="Excluir rascunho"
          onClick={() => setConfirming(true)}
        />
      )}
    </DangerZone>
  );
}

function CancelEvent({ event }: { event: MyEvent }) {
  const onUpdated = useEventUpdater();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/events/{id}/cancel', { params: { path: { id: event.id } } })),
    onSuccess: async (updated) => {
      await onUpdated(updated);
      setConfirming(false);
    },
  });

  return (
    <DangerZone>
      {confirming ? (
        <ConfirmPanel
          title="Cancelar este evento?"
          confirmLabel="Sim, cancelar evento"
          pending={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>
            As vendas param na hora. Cada pedido pago é reembolsado pelo Stripe e os ingressos dele
            são anulados; reservas ainda não pagas terminam.
          </p>
          <p>Os compradores recebem um e-mail avisando. Não dá para desfazer.</p>
        </ConfirmPanel>
      ) : (
        <DangerAction
          text="Cancelar o evento reembolsa os pedidos pagos e avisa os compradores."
          label="Cancelar evento"
          onClick={() => setConfirming(true)}
        />
      )}
    </DangerZone>
  );
}

function DangerZone({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6" aria-label="Zona de risco">
      {children}
    </section>
  );
}

function DangerAction({
  text,
  label,
  onClick,
}: {
  text: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{text}</p>
      <Button variant="secondary" className="text-danger" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}
