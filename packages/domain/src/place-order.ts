import { TicketTypeNotFoundError } from './catalog.js';
import { DomainError } from './domain-error.js';
import { compareIds } from './ids.js';
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
 *
 * Com `Idempotency-Key`, outra requisição com a mesma chave pode gravar o pedido enquanto esta
 * corre, depois do passo 1. Esta então falha: no `UNIQUE` da chave ou antes, por exemplo sem
 * estoque, porque a outra levou o último ingresso. Nos dois casos a transação volta inteira
 * e uma consulta nova devolve o pedido da outra requisição, como se fosse um replay.
 */
export async function placeOrder(
  uow: UnitOfWork,
  input: PlaceOrderInput,
  options: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  try {
    return await uow.run((repositories) => placeInTransaction(repositories, input, options));
  } catch (error) {
    const { idempotency } = input;
    const lostRace =
      idempotency !== undefined &&
      !(error instanceof IdempotencyConflictError) &&
      (error instanceof IdempotencyKeyTakenError || error instanceof DomainError);
    if (lostRace) {
      const existing = await uow.run(({ orders }) =>
        orders.findByIdempotencyKey(input.userId, idempotency.key),
      );
      if (existing) {
        return replay(existing, idempotency.requestHash);
      }
    }
    throw error;
  }
}

/** Mesma chave: mesmo corpo devolve o pedido; corpo diferente é recusado. */
function replay(existing: Order, requestHash: string): PlaceOrderResult {
  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError();
  }
  return { order: existing, replayed: true };
}

async function placeInTransaction(
  { catalog, inventory, orders }: TransactionalRepositories,
  input: PlaceOrderInput,
  { now, reservationTtlMinutes }: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  if (input.idempotency) {
    const existing = await orders.findByIdempotencyKey(input.userId, input.idempotency.key);
    if (existing) {
      return replay(existing, input.idempotency.requestHash);
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
