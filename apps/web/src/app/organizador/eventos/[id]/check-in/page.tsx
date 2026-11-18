import { type Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isUuid } from '../../../../../lib/catalog/view';

import { CheckInDesk } from './check-in-desk';

export const metadata: Metadata = { title: 'Check-in' };

/** Protegida pelo proxy (fica em /organizador): só com o papel ORGANIZER (ADR 0016). */
export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  return <CheckInDesk eventId={id} />;
}
