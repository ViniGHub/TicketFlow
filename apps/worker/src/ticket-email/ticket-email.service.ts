import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@ticketflow/db';

import { EMAIL_SENDER, type EmailSender } from './email-sender';
import { renderTicketEmail } from './render-ticket-email';

export type TicketEmailResult =
  | { status: 'sent'; tickets: number }
  | { status: 'skipped'; reason: 'order-not-found' | 'no-pending-tickets' };

/**
 * Envia os ingressos de um pedido (ROADMAP, etapa 5.2; ADR 0013). Pendente é o ingresso ainda
 * não enviado e não anulado: reprocessar o job não acha nada e não reenvia, e ingresso
 * reembolsado nunca sai.
 */
@Injectable()
export class TicketEmailService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  async sendForOrder(orderId: string): Promise<TicketEmailResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        user: { select: { name: true, email: true } },
        tickets: {
          where: { emailedAt: null, voidedAt: null },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            qrToken: true,
            ticketType: { select: { name: true } },
            event: {
              select: { id: true, title: true, venue: true, startsAt: true, timezone: true },
            },
          },
        },
      },
    });
    if (!order) {
      return { status: 'skipped', reason: 'order-not-found' };
    }
    if (order.tickets.length === 0) {
      return { status: 'skipped', reason: 'no-pending-tickets' };
    }

    const message = await renderTicketEmail({
      orderId,
      buyer: order.user,
      tickets: order.tickets.map(({ id, qrToken, ticketType, event }) => ({
        id,
        qrToken,
        ticketTypeName: ticketType.name,
        event,
      })),
    });
    // Se o envio falhar, nada é marcado e o BullMQ tenta de novo com backoff.
    await this.sender.send(message);

    // Logo depois do envio. Se o processo cair entre os dois, o e-mail sai de novo na próxima
    // tentativa (at-least-once); no Resend, o Idempotency-Key descarta a repetição.
    const ids = order.tickets.map((ticket) => ticket.id);
    await this.prisma.ticket.updateMany({
      where: { id: { in: ids }, emailedAt: null },
      data: { emailedAt: new Date() },
    });
    return { status: 'sent', tickets: ids.length };
  }
}
