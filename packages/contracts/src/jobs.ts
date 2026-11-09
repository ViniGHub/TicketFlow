import { z } from 'zod';

// Jobs que saem pela outbox (ARCHITECTURE.md, seções 7 e 8). Quem grava a linha é o domínio,
// na mesma transação da mudança de negócio; o worker valida o payload com estes schemas antes
// de processar (etapa 5.2). O payload leva só ids: o job lê o resto do banco, então nenhum
// dado pessoal fica parado na outbox.

/** O pedido virou `PAID`: gerar o QR code de cada ticket e mandar o e-mail. */
export const SEND_TICKET_EMAIL_JOB = 'send-ticket-email';

export const sendTicketEmailPayloadSchema = z.object({ orderId: z.uuid() });
export type SendTicketEmailPayload = z.infer<typeof sendTicketEmailPayloadSchema>;

/**
 * Pagamento que não pode virar ingresso (pagamento tardio sem estoque): reembolsar no Stripe
 * com `idempotencyKey = refund:<orderId>`. O job lê o PaymentIntent do pedido.
 */
export const REFUND_ORDER_JOB = 'refund-order';

export const refundOrderPayloadSchema = z.object({ orderId: z.uuid() });
export type RefundOrderPayload = z.infer<typeof refundOrderPayloadSchema>;

/**
 * Tipos de job que o domínio grava na outbox. O relay do worker publica cada um na fila de
 * mesmo nome; tipo fora desta lista não é publicado (etapa 5.1).
 */
export const OUTBOX_JOB_TYPES = [SEND_TICKET_EMAIL_JOB, REFUND_ORDER_JOB] as const;
export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[number];

export function isOutboxJobType(type: string): type is OutboxJobType {
  return OUTBOX_JOB_TYPES.some((known) => known === type);
}
