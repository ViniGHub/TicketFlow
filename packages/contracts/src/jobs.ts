import { z } from 'zod';

// Jobs que saem pela outbox (ARCHITECTURE.md, seções 7 e 8). Quem grava a linha é o domínio,
// na mesma transação da mudança de negócio; o worker valida o payload com estes schemas antes
// de processar (etapa 5.2). O payload leva só ids: o job lê o resto do banco, então nenhum
// dado pessoal fica parado na outbox.

/** O pedido virou `PAID`: gerar o QR code de cada ticket e mandar o e-mail. */
export const SEND_TICKET_EMAIL_JOB = 'send-ticket-email';

export const sendTicketEmailPayloadSchema = z.object({ orderId: z.uuid() });
export type SendTicketEmailPayload = z.infer<typeof sendTicketEmailPayloadSchema>;
