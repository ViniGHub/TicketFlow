import { DomainError } from './domain-error.js';
import { type Order, OrderNotFoundError } from './order.js';
import { transitionOrder } from './order-transition.js';
import {
  type CatalogRepository,
  type CheckoutGateway,
  type CheckoutLineItem,
  type CheckoutSession,
  type UnitOfWork,
} from './ports.js';

// Sessão de pagamento do pedido (ROADMAP, etapa 4.1; ARCHITECTURE.md, seção 5, passo 2;
// ADR 0008).

export interface CheckoutResult {
  /** O pedido como está agora, já com a sessão quando ela foi gravada. */
  order: Order;
  /** Página de pagamento do Stripe; `null` quando o pedido não pode mais ser pago por ela. */
  checkoutUrl: string | null;
}

/** O Stripe falhou ao criar, consultar ou expirar a sessão. O cliente pode tentar de novo. */
export class CheckoutUnavailableError extends DomainError {
  readonly code = 'CHECKOUT_UNAVAILABLE';

  constructor(cause: unknown) {
    super('Não foi possível iniciar o pagamento agora. Tente de novo em instantes.', { cause });
  }
}

/**
 * Abre o pagamento de um pedido, sempre fora de transação (CLAUDE.md, regra 8). Serve tanto
 * para o pedido recém-criado quanto para o replay da mesma `Idempotency-Key`:
 *
 * - Pedido que não está `PENDING`: não há o que pagar, `checkoutUrl` é `null`.
 * - `PENDING` com sessão: devolve a URL da sessão existente, sem criar outra.
 * - `PENDING` sem sessão (pedido novo, ou o processo caiu entre o commit e o Stripe): cria a
 *   sessão, com a chave de idempotência do pedido, e a grava. Se o pedido deixou de esperar
 *   por ela no meio do caminho (cancelado, expirado), a sessão é expirada e não fica gravada.
 *
 * Se a criação falhar, compensa: o pedido vira `CANCELLED` e o estoque volta.
 */
export async function startCheckout(
  uow: UnitOfWork,
  gateway: CheckoutGateway,
  order: Order,
): Promise<CheckoutResult> {
  if (order.status !== 'PENDING') {
    return { order, checkoutUrl: null };
  }
  if (order.stripeSessionId !== null) {
    return { order, checkoutUrl: await openUrlOf(gateway, order.stripeSessionId) };
  }

  const lineItems = await uow.run(({ catalog }) => lineItemsOf(catalog, order));
  let session: CheckoutSession;
  try {
    session = await gateway.createCheckoutSession({
      orderId: order.id,
      lineItems,
      expiresAt: order.expiresAt,
      orderCreatedAt: order.createdAt,
    });
  } catch (error) {
    // Se a compensação também falhar, o pedido fica PENDING sem sessão, e a expiração o encerra.
    await compensate(uow, order.id);
    throw new CheckoutUnavailableError(error);
  }
  return attach(uow, gateway, order.id, session);
}

/** Itens na ordem do pedido, com o preço copiado do lote no momento da compra. */
async function lineItemsOf(catalog: CatalogRepository, order: Order): Promise<CheckoutLineItem[]> {
  const labels = new Map(
    (await catalog.findLabels(order.items.map((item) => item.ticketTypeId))).map((label) => [
      label.id,
      label,
    ]),
  );
  return order.items.map(({ ticketTypeId, quantity, unitPriceCents }) => {
    const label = labels.get(ticketTypeId);
    // order_items referencia o lote com ON DELETE RESTRICT: faltar aqui é dado corrompido.
    if (!label) {
      throw new Error(`O lote ${ticketTypeId} do pedido ${order.id} não existe.`);
    }
    return { name: `${label.eventTitle} – ${label.name}`, quantity, unitPriceCents };
  });
}

/**
 * Grava a sessão com o pedido travado, depois de reconferir que ele continua `PENDING` sem
 * outra sessão. Senão, expira a sessão recém-criada: a URL dela nunca foi entregue, e assim
 * ninguém paga por um pedido cancelado ou expirado.
 */
async function attach(
  uow: UnitOfWork,
  gateway: CheckoutGateway,
  orderId: string,
  session: CheckoutSession,
): Promise<CheckoutResult> {
  const { order, attached } = await uow.run(async ({ orders }) => {
    const current = await orders.lockById(orderId);
    if (!current) {
      throw new OrderNotFoundError();
    }
    const waiting =
      current.status === 'PENDING' &&
      (current.stripeSessionId === null || current.stripeSessionId === session.id);
    if (!waiting) {
      return { order: current, attached: false };
    }
    if (current.stripeSessionId === null) {
      await orders.setCheckoutSession(orderId, session.id);
    }
    return { order: { ...current, stripeSessionId: session.id }, attached: true };
  });

  if (attached) {
    return { order, checkoutUrl: session.url };
  }
  try {
    await gateway.expireCheckoutSession(session.id);
  } catch (error) {
    throw new CheckoutUnavailableError(error);
  }
  // O pedido já não está PENDING sem sessão: daqui não volta a criar outra.
  return startCheckout(uow, gateway, order);
}

/**
 * `PENDING → CANCELLED`, devolvendo o estoque, só se o pedido ainda espera por uma sessão.
 * Outra requisição com a mesma `Idempotency-Key` pode ter gravado a sessão enquanto esta
 * falhava: cancelar então deixaria uma sessão pagável num pedido cancelado.
 */
async function compensate(uow: UnitOfWork, orderId: string): Promise<void> {
  await uow.run(async (repositories) => {
    const current = await repositories.orders.lockById(orderId);
    if (current?.status === 'PENDING' && current.stripeSessionId === null) {
      await transitionOrder(repositories, current, 'CANCELLED');
    }
  });
}

async function openUrlOf(gateway: CheckoutGateway, sessionId: string): Promise<string | null> {
  try {
    const session = await gateway.retrieveCheckoutSession(sessionId);
    return session.status === 'open' ? session.url : null;
  } catch (error) {
    throw new CheckoutUnavailableError(error);
  }
}
