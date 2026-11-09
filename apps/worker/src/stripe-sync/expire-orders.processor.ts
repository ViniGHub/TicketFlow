import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { EXPIRE_ORDERS_JOB } from '@ticketflow/contracts';
import { type Job } from 'bullmq';

import { errorMessage, jobFields, LoggedProcessor } from '../queues/logged-processor';

import { StripeSyncService } from './stripe-sync.service';

/** Quantos pedidos caíram em cada caso: o valor de retorno que o BullMQ guarda com o job. */
export interface ExpireOrdersResult {
  expired: number;
  alreadyHandled: number;
  paid: number;
  failed: number;
}

/** Consumidor da fila `expire-orders`, que o scheduler alimenta a cada minuto (ADR 0014). */
@Processor(EXPIRE_ORDERS_JOB)
export class ExpireOrdersProcessor extends LoggedProcessor {
  protected override readonly completedLogLevel = 'debug';

  constructor(@Inject(StripeSyncService) private readonly sync: StripeSyncService) {
    super();
  }

  async process(job: Job): Promise<ExpireOrdersResult> {
    const report = await this.sync.expireOrders(new Date());
    const fields = jobFields(job);
    for (const orderId of report.expired) {
      this.logger.log({ message: 'Pedido expirado; estoque devolvido', ...fields, orderId });
    }
    for (const { orderId, result } of report.paid) {
      this.logger.log({
        message: 'Sessão já paga na expiração; pagamento aplicado',
        ...fields,
        orderId,
        outcome: result?.status ?? 'order-without-session',
      });
    }
    for (const { orderId, error } of report.failed) {
      this.logger.warn({
        message: 'Pedido não expirado; fica para a próxima execução',
        ...fields,
        orderId,
        error: errorMessage(error),
      });
    }
    return {
      expired: report.expired.length,
      alreadyHandled: report.alreadyHandled.length,
      paid: report.paid.length,
      failed: report.failed.length,
    };
  }
}
