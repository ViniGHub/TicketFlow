import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MY_EVENTS_QUERY_KEY, MyEvents } from '../../app/organizador/my-events';
import { eventFormValuesOf } from '../../lib/organizer/events';

import { EventForm } from './event-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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
