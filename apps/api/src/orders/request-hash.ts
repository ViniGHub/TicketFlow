import { createHash } from 'node:crypto';

/**
 * SHA-256 do corpo do pedido normalizado (ARCHITECTURE.md, seção 7): itens em ordem de lote,
 * ids em minúsculas e só os campos que importam. A mesma compra escrita em outra ordem dá o
 * mesmo hash; outra quantidade ou outro lote, não.
 */
export function orderRequestHash(
  items: readonly { ticketTypeId: string; quantity: number }[],
): string {
  const canonical = items
    .map(({ ticketTypeId, quantity }) => ({ ticketTypeId: ticketTypeId.toLowerCase(), quantity }))
    .sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : 1));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
