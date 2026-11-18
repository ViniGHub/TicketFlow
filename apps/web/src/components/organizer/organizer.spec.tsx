import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { formatCents } from '../../lib/format';
import { ManageEvent } from '../../app/organizador/eventos/[id]/manage-event';
import { MyEvents } from '../../app/organizador/my-events';
import { eventFormValuesOf } from '../../lib/organizer/events';
import { MY_EVENTS_QUERY_KEY, type MyEvent, myEventQueryKey } from '../../lib/organizer/queries';

import { ConfirmPanel } from './confirm-panel';

import { EventForm } from './event-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/organizador',
}));

describe('EventForm', () => {
  it('ao editar, os campos vêm preenchidos com a hora no fuso do evento', () => {
    const html = renderToStaticMarkup(
      <EventForm
        initial={eventFormValuesOf({
          title: 'Jazz no Parque',
          description: '',
          venue: 'Parque',
          timezone: 'America/Manaus',
          startsAt: '2026-12-21T00:00:00.000Z',
        })}
        submitLabel="Salvar"
        cancelHref="/organizador"
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain('value="Jazz no Parque"');
    expect(html).toContain('value="2026-12-20T20:00"');
    expect(html).toMatch(/<option value="America\/Manaus" selected="">/);
    expect(html).toContain('type="submit"');
    expect(html).toContain('href="/organizador"');
  });
});

describe('MyEvents', () => {
  const render = (items: object[]) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_EVENTS_QUERY_KEY, {
      pages: [{ items, nextCursor: null }],
      pageParams: [undefined],
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MyEvents />
      </QueryClientProvider>,
    );
  };

  it('cada evento com o status, a data no fuso dele e o link de gestão', () => {
    const id = '0193a4f2-0000-7000-8000-0000000000e1';
    const html = render([
      {
        id,
        title: 'Jazz no Parque',
        venue: 'Parque Ibirapuera',
        timezone: 'America/Sao_Paulo',
        startsAt: '2026-12-20T23:00:00.000Z',
        status: 'DRAFT',
      },
    ]);

    expect(html).toContain('Jazz no Parque');
    expect(html).toContain('Rascunho');
    expect(html).toContain('20:00');
    expect(html).toContain(`href="/organizador/eventos/${id}"`);
  });

  it('sem eventos: explica o que vem depois de criar', () => {
    expect(render([])).toContain('Você ainda não criou nenhum evento.');
  });
});

describe('ManageEvent', () => {
  const id = '0193a4f2-0000-7000-8000-0000000000e2';
  const lot = {
    id: '0193a4f2-0000-7000-8000-0000000000f1',
    name: 'Pista',
    priceCents: 8_000,
    total: 200,
    available: 37,
    maxPerOrder: 4,
    salesStart: '2026-11-20T13:00:00.000Z',
    salesEnd: '2026-12-20T22:00:00.000Z',
  };
  const base: MyEvent = {
    id,
    title: 'Jazz no Parque',
    description: '',
    venue: 'Parque Ibirapuera',
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-12-20T23:00:00.000Z',
    status: 'DRAFT',
    ticketTypes: [],
  };
  const render = (event: MyEvent) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(myEventQueryKey(id), event);
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ManageEvent eventId={id} />
      </QueryClientProvider>,
    );
  };

  it('rascunho sem lote: publicar fica desabilitado, com o motivo; dá para excluir', () => {
    const html = render(base);

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publicar<\/button>/);
    expect(html).toContain('Cadastre ao menos um lote para publicar.');
    expect(html).toContain('Adicionar lote');
    expect(html).toContain('Excluir rascunho');
    expect(html).not.toContain('Cancelar evento');
  });

  it('publicado: vendas, check-in e o cancelamento; os lotes com preço e vendidos', () => {
    const html = render({ ...base, status: 'PUBLISHED', ticketTypes: [lot] });

    expect(html).toContain(`href="/organizador/eventos/${id}/vendas"`);
    expect(html).toContain(`href="/organizador/eventos/${id}/check-in"`);
    expect(html).toContain('Cancelar evento');
    expect(html).toContain(formatCents(8_000));
    expect(html).toContain('163 de 200 vendidos ou reservados');
    expect(html).toContain('aria-label="Editar o lote Pista"');
    expect(html).not.toContain('Excluir rascunho');
  });

  it('cancelado: só leitura, com o aviso do reembolso', () => {
    const html = render({ ...base, status: 'CANCELLED', ticketTypes: [lot] });

    expect(html).toContain('Evento cancelado.');
    expect(html).not.toContain('Adicionar lote');
    expect(html).not.toContain('Editar o lote');
    expect(html).not.toContain('/editar');
    expect(html).not.toContain('Cancelar evento');
  });
});

describe('ConfirmPanel', () => {
  it('explica, pede o segundo clique e mostra o erro da tentativa', () => {
    const html = renderToStaticMarkup(
      <ConfirmPanel
        title="Cancelar este evento?"
        confirmLabel="Sim, cancelar evento"
        pending={false}
        error={new Error('falhou')}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <p>Não dá para desfazer.</p>
      </ConfirmPanel>,
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('Sim, cancelar evento');
    expect(html).toContain('Voltar');
    expect(html).toContain('role="alert"');
  });
});
