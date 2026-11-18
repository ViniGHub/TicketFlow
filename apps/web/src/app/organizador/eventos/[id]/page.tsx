import { type Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isUuid } from '../../../../lib/catalog/view';

import { ManageEvent } from './manage-event';

export const metadata: Metadata = { title: 'Gerenciar evento' };

/** Protegida pelo proxy (fica em /organizador): só com o papel ORGANIZER (ADR 0016). */
export default async function ManageEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  return <ManageEvent eventId={id} />;
}
