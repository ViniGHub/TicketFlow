import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type PaymentEvent,
  StripeEventProcessor,
  type StripeEventOutcome,
  type UnitOfWork,
} from '@ticketflow/domain';
import { InvalidWebhookSignatureError, StripeWebhookParser } from '@ticketflow/payments';

import { PrismaUnitOfWork } from '../orders/persistence/prisma-unit-of-work';
import { STRIPE_WEBHOOK_PARSER } from '../payments/payments.module';

/**
 * O processamento falhou e foi desfeito, inclusive o registro do evento. Vira 500 mesmo
 * quando a causa é um erro de domínio (que o filtro mapearia para 4xx): o problema não está
 * no que o Stripe mandou, e só um 5xx deixa claro que ele deve reenviar (CLAUDE.md, regra 6).
 */
export class StripeEventProcessingError extends Error {
  constructor(event: PaymentEvent, cause: unknown) {
    super(`Falha ao processar o evento ${event.id} (${event.type}) do Stripe.`, { cause });
    this.name = 'StripeEventProcessingError';
  }
}

/** Motivos de evento ignorado que pedem atenção de quem opera; os outros são rotina. */
const WARN_REASONS = new Set([
  'not-ticketflow',
  'order-not-found',
  'session-mismatch',
  'partial-refund',
  'not-refundable',
]);

/** Webhook do Stripe (ARCHITECTURE.md, seção 5, passo 4; ADR 0009). */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly processor: StripeEventProcessor;

  constructor(
    @Inject(PrismaUnitOfWork) uow: UnitOfWork,
    @Inject(STRIPE_WEBHOOK_PARSER) private readonly parser: StripeWebhookParser,
  ) {
    this.processor = new StripeEventProcessor(uow);
  }

  async handle(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<StripeEventOutcome> {
    const event = this.parse(rawBody, signature);
    let outcome: StripeEventOutcome;
    try {
      outcome = await this.processor.process(event);
    } catch (error) {
      throw new StripeEventProcessingError(event, error);
    }
    this.report(event, outcome);
    return outcome;
  }

  private parse(rawBody: Buffer | undefined, signature: string | undefined): PaymentEvent {
    try {
      // Sem corpo cru (Content-Type que não é JSON) não há como conferir a assinatura.
      if (!rawBody) {
        throw new InvalidWebhookSignatureError();
      }
      return this.parser.parse(rawBody, signature);
    } catch (error) {
      if (error instanceof InvalidWebhookSignatureError) {
        throw new BadRequestException({
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: error.message,
        });
      }
      throw error;
    }
  }

  private report(event: PaymentEvent, outcome: StripeEventOutcome): void {
    const fields = { stripeEventId: event.id, stripeEventType: event.type, ...outcome };
    if (outcome.status === 'ignored' && WARN_REASONS.has(outcome.reason)) {
      this.logger.warn(fields, 'Evento do Stripe ignorado');
    } else if (outcome.status === 'processed' && outcome.warning) {
      // Pagamento tardio (reservado de novo ou a reembolsar) ou reembolso feito pelo painel.
      this.logger.warn(fields, 'Evento do Stripe processado fora do caminho normal');
    } else {
      this.logger.log(fields, 'Evento do Stripe recebido');
    }
  }
}
