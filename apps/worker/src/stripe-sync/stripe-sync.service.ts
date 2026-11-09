import { Inject, Injectable } from '@nestjs/common';
import {
  ExpirationService,
  type ReconcileResult,
  type ReconciliationSummary,
  StripeReconciler,
} from '@ticketflow/domain';

export interface ExpireOrdersReport {
  /** Expirados agora, com o estoque devolvido. */
  expired: string[];
  /** Outra execução, um cancelamento ou o webhook trataram o pedido antes. */
  alreadyHandled: string[];
  /** A sessão já estava paga: o pagamento foi aplicado como o webhook faria. */
  paid: { orderId: string; result: ReconcileResult | null }[];
  /** O pedido fica para a próxima execução. */
  failed: { orderId: string; error: unknown }[];
}

/**
 * O que os jobs recorrentes fazem (ROADMAP, etapa 5.3; ARCHITECTURE.md, seção 5, passos 6 e
 * 7; ADR 0014). As regras ficam no domínio; aqui elas só são compostas.
 */
@Injectable()
export class StripeSyncService {
  constructor(
    @Inject(ExpirationService) private readonly expiration: ExpirationService,
    @Inject(StripeReconciler) private readonly reconciler: StripeReconciler,
  ) {}

  /**
   * `expire-orders`: expira os pedidos `PENDING` vencidos. Quando o Stripe responde que a sessão
   * já foi paga, o pagamento venceu a corrida: o pedido vira `PAID` agora, pelo mesmo caminho do
   * webhook, em vez de esperar por ele. O estoque continua reservado.
   */
  async expireOrders(now: Date): Promise<ExpireOrdersReport> {
    const summary = await this.expiration.expireDue(now);
    const report: ExpireOrdersReport = {
      expired: summary.expired,
      alreadyHandled: summary.alreadyHandled,
      paid: [],
      failed: [...summary.failed],
    };
    for (const orderId of summary.paymentCompleted) {
      try {
        report.paid.push({ orderId, result: await this.reconciler.reconcileOrder(orderId, now) });
      } catch (error) {
        report.failed.push({ orderId, error });
      }
    }
    return report;
  }

  /** `reconcile-stripe`: recupera webhooks perdidos dos pedidos esperando pagamento. */
  reconcile(now: Date): Promise<ReconciliationSummary> {
    return this.reconciler.reconcileAwaitingPayment(now);
  }
}
