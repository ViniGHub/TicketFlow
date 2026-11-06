import { z } from 'zod';

import { CATALOG_LIMITS } from './events.js';

// Pedidos (ARCHITECTURE.md, seções 5 e 7). Aqui fica a forma da entrada (400); as regras que
// dependem do lote e do evento (janela de vendas, max_per_order, estoque) ficam em
// packages/domain.

export const ORDER_LIMITS = {
  /** Lotes diferentes num mesmo pedido. */
  maxItems: 10,
  /** Tamanho máximo do header `Idempotency-Key`, o mesmo do Stripe. */
  maxIdempotencyKeyLength: 255,
} as const;

/** Mesmos valores do enum `order_status` do banco (ARCHITECTURE.md, seção 4). */
export const orderStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]);
export type OrderStatusValue = z.infer<typeof orderStatusSchema>;

export const orderItemRequestSchema = z.object({
  // Minúsculas: o hash da Idempotency-Key compara o corpo normalizado.
  ticketTypeId: z
    .uuid()
    .transform((id) => id.toLowerCase())
    .meta({ example: '0193a4f2-7c1e-7b3d-9a51-3f0c2d8e4b61' }),
  quantity: z.int().min(1).max(CATALOG_LIMITS.maxPerOrder).meta({ example: 2 }),
});

/** `POST /orders`: cada lote aparece uma vez só; o limite por lote é regra do domínio. */
export const createOrderRequestSchema = z.object({
  items: z
    .array(orderItemRequestSchema)
    .min(1)
    .max(ORDER_LIMITS.maxItems)
    .refine(
      (items) => new Set(items.map((item) => item.ticketTypeId)).size === items.length,
      'Cada lote pode aparecer uma vez só no pedido.',
    ),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/**
 * Header `Idempotency-Key` (opcional). Uma chave por tentativa de compra: repetir a chave com
 * o mesmo corpo devolve o pedido já criado (ARCHITECTURE.md, seção 7).
 */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(ORDER_LIMITS.maxIdempotencyKeyLength)
  .regex(/^[\x21-\x7E]+$/, 'Use só caracteres ASCII visíveis, sem espaços.')
  .optional();

export const orderItemResponseSchema = z.object({
  ticketTypeId: z.uuid(),
  quantity: z.int(),
  /** Preço do lote no momento da compra. */
  unitPriceCents: z.int(),
});

export const orderResponseSchema = z.object({
  id: z.uuid(),
  status: orderStatusSchema,
  totalCents: z.int(),
  currency: z.literal('BRL'),
  /** Fim da reserva: depois disso, o pedido não pago expira e o estoque volta. */
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  items: z.array(orderItemResponseSchema),
});
export type OrderResponse = z.infer<typeof orderResponseSchema>;

/** `POST /orders`: o pedido e a página de pagamento do Stripe (ARCHITECTURE.md, seção 5). */
export const createOrderResponseSchema = orderResponseSchema.extend({
  /**
   * Para onde levar o comprador. `null` quando o pedido não pode mais ser pago por ela: no
   * replay de um pedido cancelado, expirado, pago ou com a sessão já encerrada.
   */
  checkoutUrl: z.url().nullable().meta({ example: 'https://checkout.stripe.com/c/pay/cs_test_a1' }),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;
