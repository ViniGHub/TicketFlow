import { type Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isUuid } from '../../../../../lib/catalog/view';

import { EditEvent } from './edit-event';

export const metadata: Metadata = { title: 'Editar evento' };

/** Protegida pelo proxy (fica em /organizador): só com o papel ORGANIZER (ADR 0016). */
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEvent eventId={id} />
    </div>
  );
}
