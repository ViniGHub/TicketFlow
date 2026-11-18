import { type Metadata } from 'next';
import Link from 'next/link';

import { buttonClasses } from '../../components/ui/button';

import { MyEvents } from './my-events';

export const metadata: Metadata = { title: 'Meus eventos' };

/** Protegida pelo proxy: só com o papel ORGANIZER (ADR 0016). */
export default function OrganizerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Meus eventos</h1>
        <Link href="/organizador/eventos/novo" className={buttonClasses('primary')}>
          Criar evento
        </Link>
      </div>
      <MyEvents />
    </div>
  );
}
