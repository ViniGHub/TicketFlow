import { EventGrid } from '../components/catalog/event-grid';
import { toEventCard } from '../lib/catalog/view';
import { serverApi } from '../lib/server/api';

// O catálogo muda a cada evento publicado e a cada compra: renderizado a cada visita.
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const { data, response } = await serverApi().GET('/events');
  if (!data) {
    // Cai no error.tsx, com a opção de tentar de novo.
    throw new Error(`Catálogo indisponível (HTTP ${response.status}).`);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Próximos eventos</h1>
        <p className="text-muted">
          Escolha o evento, garanta o ingresso e entre com o QR code no celular.
        </p>
      </header>
      <EventGrid firstPage={{ items: data.items.map(toEventCard), nextCursor: data.nextCursor }} />
    </div>
  );
}
