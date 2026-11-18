import { type Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isUuid } from '../../../../../lib/catalog/view';

import { SalesDashboard } from './sales-dashboard';

export const metadata: Metadata = { title: 'Vendas do evento' };

/** Protegida pelo proxy (fica em /organizador): só com o papel ORGANIZER (ADR 0016). */
export default async function SalesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  return <SalesDashboard eventId={id} />;
}
