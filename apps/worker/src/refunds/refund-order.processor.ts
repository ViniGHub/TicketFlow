import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { REFUND_ORDER_JOB, refundOrderPayloadSchema } from '@ticketflow/contracts';
import {
  type PaymentGateway,
  refundOrder,
  type RefundOrderResult,
  type UnitOfWork,
} from '@ticketflow/domain';
import { PrismaUnitOfWork } from '@ticketflow/persistence';
import { type Job, UnrecoverableError } from 'bullmq';

import { PAYMENT_GATEWAY } from '../payments/payments.module';
import { jobFields, LoggedProcessor } from '../queues/logged-processor';

/**
 * Consumidor da fila `refund-order` (ARCHITECTURE.md, seção 8; ADR 0015): pagamento tardio sem
 * estoque e evento cancelado. Falha do Stripe sobe, e o BullMQ tenta de novo com backoff.
 */
@Processor(REFUND_ORDER_JOB)
export class RefundOrderProcessor extends LoggedProcessor {
  constructor(
    @Inject(PrismaUnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {
    super();
  }

  async process(job: Job): Promise<RefundOrderResult> {
    const payload = refundOrderPayloadSchema.safeParse(job.data);
    if (!payload.success) {
      throw new UnrecoverableError(`Payload inválido: ${payload.error.message}`);
    }

    const result = await refundOrder(this.uow, this.gateway, payload.data.orderId);
    if (result.status === 'skipped') {
      const fields = { message: 'Reembolso não pedido', ...jobFields(job), reason: result.reason };
      if (result.reason === 'already-refunded') {
        // Job repetido depois do charge.refunded: é o caminho normal.
        this.logger.log(fields);
      } else {
        this.logger.warn(fields);
      }
    }
    return result;
  }
}
