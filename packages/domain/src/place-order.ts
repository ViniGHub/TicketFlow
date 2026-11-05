import { TicketTypeNotFoundError } from './catalog.js';
import {
  assertPurchasable,
  calculateOrderTotal,
  IdempotencyConflictError,
  InsufficientStockError,
  type Order,
  type OrderItem,
} from './order.js';
import {
  IdempotencyKeyTakenError,
  type TransactionalRepositories,
  type UnitOfWork,
} from './ports.js';

// Criação de pedido (ROADMAP, etapa 3.2; ARCHITECTURE.md, seções 5, 6 e 7; ADR 0006).

export interface PlaceOrderInput {
  userId: string;
  items: readonly { ticketTypeId: string; quantity: number }[];
  /** `Idempotency-Key` e o hash do corpo normalizado, quando o cliente mandou a chave. */
  idempotency?: { key: string; requestHash: string };
}

export interface PlaceOrderOptions {
  now: Date;
  reservationTtlMinutes: number;
}

export interface PlaceOrderResult {
  order: Order;
  /** `true` quando uma requisição anterior com a mesma chave já tinha criado o pedido. */
  replayed: boolean;
}

const MINUTE_MS = 60_000;

/**
 * Cria um pedido `PENDING` e reserva o estoque, numa única transação:
 *
 * 1. `Idempotency-Key` já usada: devolve o pedido existente, ou recusa se o corpo era outro.
 * 2. Trava os eventos (modo compartilhado), lê os lotes e valida todos os itens antes de
 *    reservar qualquer um.
 * 3. Reserva lote a lote, em ordem de id, para duas compras nunca se travarem em ordens
 *    opostas. Se faltar estoque em um, a transação inteira volta e nada fica reservado.
 * 4. Grava o pedido com o preço atual de cada lote e a reserva valendo até `now + TTL`.
 */
export async function placeOrder(
  uow: UnitOfWork,
  input: PlaceOrderInput,
  options: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  try {
    return await uow.run((repositories) => placeInTransaction(repositories, input, options));
  } catch (error) {
    // Outra requisição com a mesma chave gravou primeiro e o UNIQUE desfez esta transação
    // inteira, inclusive a reserva. A nova tentativa encontra o pedido dela no passo 1.
    if (error instanceof IdempotencyKeyTakenError) {
      return uow.run((repositories) => placeInTransaction(repositories, input, options));
    }
    throw error;
  }
}

async function placeInTransaction(
  { catalog, inventory, orders }: TransactionalRepositories,
  input: PlaceOrderInput,
  { now, reservationTtlMinutes }: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  if (input.idempotency) {
    const existing = await orders.findByIdempotencyKey(input.userId, input.idempotency.key);
    if (existing) {
      if (existing.requestHash !== input.idempotency.requestHash) {
        throw new IdempotencyConflictError();
      }
      return { order: existing, replayed: true };
    }
  }

  const requested = [...input.items].sort((a, b) => compareIds(a.ticketTypeId, b.ticketTypeId));
  // A borda da API já recusa lote repetido (400); aqui seria erro de programação.
  requested.forEach((item, index) => {
    if (index > 0 && requested[index - 1]?.ticketTypeId === item.ticketTypeId) {
      throw new RangeError(`Lote repetido no pedido: ${item.ticketTypeId}`);
    }
  });
  const ticketTypes = new Map(
    (await catalog.lockForPurchase(requested.map((item) => item.ticketTypeId))).map(
      (ticketType) => [ticketType.id, ticketType],
    ),
  );

  const items: OrderItem[] = requested.map(({ ticketTypeId, quantity }) => {
    const ticketType = ticketTypes.get(ticketTypeId);
    if (!ticketType) {
      throw new TicketTypeNotFoundError(ticketTypeId);
    }
    assertPurchasable({ event: ticketType.event, ticketType, quantity }, now);
    return { ticketTypeId, quantity, unitPriceCents: ticketType.priceCents };
  });
  const totalCents = calculateOrderTotal(items);

  for (const { ticketTypeId, quantity } of items) {
    if (!(await inventory.tryReserve(ticketTypeId, quantity))) {
      throw new InsufficientStockError(ticketTypeId);
    }
  }

  const order = await orders.create({
    userId: input.userId,
    items,
    totalCents,
    expiresAt: new Date(now.getTime() + reservationTtlMinutes * MINUTE_MS),
    idempotencyKey: input.idempotency?.key ?? null,
    requestHash: input.idempotency?.requestHash ?? null,
  });
  return { order, replayed: false };
}

/** Mesma ordem do tipo `uuid` do Postgres para ids em minúsculas. */
function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
