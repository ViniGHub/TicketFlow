import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { RECONCILE_STRIPE_JOB } from '@ticketflow/contracts';
import { type Job } from 'bullmq';

import { errorMessage, jobFields, LoggedProcessor } from '../queues/logged-processor';

import { StripeSyncService } from './stripe-sync.service';

/** Quantos pedidos caíram em cada caso: o valor de retorno que o BullMQ guarda com o job. */
export interface ReconcileStripeResult {
  checked: number;
  /** O pedido mudou: o webhook não tinha chegado. */
  updated: number;
  stillOpen: number;
  failed: number;
}

/** Consumidor da fila `reconcile-stripe`, que o scheduler alimenta a cada 15 min (ADR 0014). */
@Processor(RECONCILE_STRIPE_JOB)
export class ReconcileStripeProcessor extends LoggedProcessor {
  protected override readonly completedLogLevel = 'debug';

  constructor(@Inject(StripeSyncService) private readonly sync: StripeSyncService) {
    super();
  }

  async process(job: Job): Promise<ReconcileStripeResult> {
    const summary = await this.sync.reconcile(new Date());
    const fields = jobFields(job);
    let updated = 0;
    let stillOpen = 0;
    for (const { orderId, result } of summary.reconciled) {
      if (result.status === 'still-open') {
        stillOpen += 1;
      } else if (result.status === 'processed') {
        updated += 1;
        // Mais de 10 min sem o webhook: vale olhar o endpoint no painel do Stripe.
        this.logger.warn({
          message: 'Pedido atualizado pela reconciliação; o webhook não chegou',
          ...fields,
          orderId,
          orderStatus: result.orderStatus,
          ...(result.warning && { warning: result.warning }),
        });
      }
    }
    for (const { orderId, error } of summary.failed) {
      this.logger.warn({
        message: 'Pedido não reconciliado; fica para a próxima execução',
        ...fields,
        orderId,
        error: errorMessage(error),
      });
    }
    return {
      checked: summary.reconciled.length + summary.failed.length,
      updated,
      stillOpen,
      failed: summary.failed.length,
    };
  }
}
