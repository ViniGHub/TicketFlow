import { type MeResponse } from '@ticketflow/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SESSION_QUERY_KEY } from '../lib/session/use-session';

import { SiteHeader } from './site-header';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Field } from './ui/field';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe('Button', () => {
  it('carregando: desabilitado, com aria-busy e o indicador', () => {
    const html = renderToStaticMarkup(<Button loading>Entrar</Button>);

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
  });

  it('é type="button" por padrão: não envia formulário sem querer', () => {
    expect(renderToStaticMarkup(<Button>Ok</Button>)).toContain('type="button"');
  });
});

describe('Field', () => {
  it('rótulo ligado ao campo, e o erro marca o campo como inválido', () => {
    const html = renderToStaticMarkup(<Field id="email" label="E-mail" error="E-mail inválido" />);

    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-mensagem"');
    expect(html).toContain('id="email-mensagem"');
  });

  it('sem erro nem dica, não aponta para mensagem nenhuma', () => {
    const html = renderToStaticMarkup(<Field id="nome" label="Nome" />);

    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('Alert', () => {
  it('erro é anunciado na hora; o resto, como status', () => {
    expect(renderToStaticMarkup(<Alert tone="error">x</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert>x</Alert>)).toContain('role="status"');
  });
});

describe('SiteHeader', () => {
  function render(user: MeResponse | null) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, user);
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SiteHeader />
      </QueryClientProvider>,
    );
  }

  const ana: MeResponse = {
    id: '0193a4f2-0000-7000-8000-000000000001',
    email: 'ana@teste.local',
    name: 'Ana',
    roles: ['BUYER'],
  };

  it('sem sessão: entrar e criar conta', () => {
    const html = render(null);

    expect(html).toContain('href="/entrar"');
    expect(html).toContain('href="/cadastro"');
    expect(html).not.toContain('Sair');
  });

  it('comprador logado: conta e sair, sem a área do organizador', () => {
    const html = render(ana);

    expect(html).toContain('href="/conta"');
    expect(html).toContain('Ana');
    expect(html).toContain('Sair');
    expect(html).not.toContain('href="/organizador"');
  });

  it('organizador vê o link da área dele', () => {
    expect(render({ ...ana, roles: ['BUYER', 'ORGANIZER'] })).toContain('href="/organizador"');
  });
});
