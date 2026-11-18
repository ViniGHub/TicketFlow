import { type Metadata } from 'next';

import { OrganizerHome } from './organizer-home';

export const metadata: Metadata = { title: 'Área do organizador' };

/** Protegida pelo proxy: só com o papel ORGANIZER (ADR 0016). */
export default function OrganizerPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Área do organizador</h1>
      <OrganizerHome />
    </div>
  );
}
