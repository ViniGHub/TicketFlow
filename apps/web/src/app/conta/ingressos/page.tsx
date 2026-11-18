import { type Metadata } from 'next';

import { TicketList } from './ticket-list';

export const metadata: Metadata = { title: 'Meus ingressos' };

/** Protegida pelo proxy (fica em /conta): só com sessão (ADR 0016). */
export default function MyTicketsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Meus ingressos</h1>
      <TicketList />
    </div>
  );
}
