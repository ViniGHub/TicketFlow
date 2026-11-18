import { type Metadata } from 'next';

import { NewEvent } from './new-event';

export const metadata: Metadata = { title: 'Criar evento' };

/** Protegida pelo proxy (fica em /organizador): só com o papel ORGANIZER (ADR 0016). */
export default function NewEventPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Criar evento</h1>
        <p className="text-sm text-muted">
          O evento fica como rascunho até você publicar. Os lotes vêm no próximo passo.
        </p>
      </div>
      <NewEvent />
    </div>
  );
}
