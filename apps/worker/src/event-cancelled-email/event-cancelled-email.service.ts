import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@ticketflow/db';

import { EMAIL_SENDER, type EmailSender } from '../email/email-sender';

import { type CancelledEvent, renderEventCancelledEmail } from './render-event-cancelled-email';

export type EventCancelledEmailResult =
  { status: 'sent' } | { status: 'skipped'; reason: 'order-not-found' | 'no-cancelled-event' };

/**
 * Avisa o comprador de que o evento foi cancelado (ROADMAP, etapa 5.4; ADR 0015). Sem marca de
 * envio no banco: reprocessar o job envia de novo. No Resend, o `Idempotency-Key` descarta a
 * repetição por 24 h; o job só se repete se o processo cair entre o envio e a conclusão.
 */
@Injectable()
export class EventCancelledEmailService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  async sendForOrder(orderId: string): Promise<EventCancelledEmailResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        totalCents: true,
        stripePaymentIntentId: true,
        user: { select: { name: true, email: true } },
        items: {
          select: {
            quantity: true,
            ticketType: {
              select: {
                event: {
                  select: {
                    id: true,
                    title: true,
                    venue: true,
                    startsAt: true,
                    timezone: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) {
      return { status: 'skipped', reason: 'order-not-found' };
    }

    const cancelled = new Map<string, CancelledEvent>();
    for (const { ticketType } of order.items) {
      const { id, status, ...event } = ticketType.event;
      if (status === 'CANCELLED') {
        cancelled.set(id, event);
      }
    }
    if (cancelled.size === 0) {
      return { status: 'skipped', reason: 'no-cancelled-event' };
    }

    await this.sender.send(
      renderEventCancelledEmail({
        orderId,
        buyer: order.user,
        events: [...cancelled.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
        ticketCount: order.items.reduce((total, item) => total + item.quantity, 0),
        // Pedido com PaymentIntent teve cobrança, e o reembolso é sempre do pedido inteiro.
        refundCents: order.stripePaymentIntentId === null ? 0 : order.totalCents,
      }),
    );
    return { status: 'sent' };
  }
}
