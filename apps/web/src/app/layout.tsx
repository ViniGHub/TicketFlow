import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { SiteHeader } from '../components/site-header';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'TicketFlow', template: '%s · TicketFlow' },
  description: 'Venda de ingressos para eventos pequenos.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
        </Providers>
        <footer className="border-t border-line py-6 text-center text-sm text-muted">
          TicketFlow · projeto de portfólio, pagamentos no modo de teste do Stripe
        </footer>
      </body>
    </html>
  );
}
