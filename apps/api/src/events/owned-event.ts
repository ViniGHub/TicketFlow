import { type PrismaClient } from '@ticketflow/db';
import { EventNotFoundError } from '@ticketflow/domain';

/**
 * Leitura do organizador sobre o próprio evento (check-in, vendas), sem trava: as escritas do
 * catálogo usam `lockOwnedEvent`. Evento de outro organizador responde 404, como se não
 * existisse.
 */
export async function assertOwnsEvent(
  prisma: PrismaClient,
  organizerId: string,
  eventId: string,
): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizerId },
    select: { id: true },
  });
  if (!event) {
    throw new EventNotFoundError();
  }
}
