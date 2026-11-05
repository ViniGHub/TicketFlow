import { transitionOrder } from './order-transition.js';
import { type SessionExpirer, type UnitOfWork } from './ports.js';

// Expiração de pedidos não pagos (ROADMAP, etapa 3.3; ARCHITECTURE.md, seção 5, passo 6;
// ADR 0007). O job `expire-orders` do worker (etapa 5.3) chama `expireDue` a cada minuto.

export const DEFAULT_EXPIRATION_BATCH_SIZE = 100;

export interface ExpirationSummary {
  /** Expirados agora, com o estoque devolvido. */
  expired: string[];
  /** Outra execução da expiração, ou um cancelamento, tratou o pedido antes. */
  alreadyHandled: string[];
  /** A sessão já estava paga: o pagamento venceu a corrida e o estoque fica reservado. */
  paymentCompleted: string[];
  /** Erro ao expirar a sessão ou ao gravar: o pedido fica para a próxima execução. */
  failed: { orderId: string; error: unknown }[];
}

export class ExpirationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sessionExpirer: SessionExpirer,
  ) {}

  /**
   * Expira um lote de pedidos `PENDING` vencidos. Nenhuma chamada ao Stripe acontece com
   * transação aberta (CLAUDE.md, regra 8), e o estoque só volta depois de a sessão expirar:
   *
   * 1. Uma transação curta pega os candidatos. `SKIP LOCKED` pula os pedidos que outra
   *    execução ou um cancelamento está processando; as travas acabam com a transação.
   * 2. Para cada um, fora de transação, expira a sessão no Stripe, se houver.
   * 3. Uma transação por pedido trava, **reconfere** que ele continua `PENDING` e só então
   *    devolve o estoque e marca `EXPIRED`. É a reconferência que garante devolver uma vez só,
   *    mesmo com duas execuções ao mesmo tempo.
   *
   * `PROCESSING` nunca é expirado aqui: o Stripe ainda vai confirmar ou recusar o Pix.
   */
  async expireDue(
    now: Date,
    batchSize = DEFAULT_EXPIRATION_BATCH_SIZE,
  ): Promise<ExpirationSummary> {
    const summary: ExpirationSummary = {
      expired: [],
      alreadyHandled: [],
      paymentCompleted: [],
      failed: [],
    };
    const due = await this.uow.run(({ orders }) => orders.lockExpiredPending(now, batchSize));

    for (const candidate of due) {
      try {
        if (candidate.stripeSessionId) {
          const result = await this.sessionExpirer.expireCheckoutSession(candidate.stripeSessionId);
          if (result === 'complete') {
            // A etapa 5.3 aplica aqui o mesmo tratamento do webhook de pagamento.
            summary.paymentCompleted.push(candidate.id);
            continue;
          }
        }

        const expired = await this.uow.run(async (repositories) => {
          const order = await repositories.orders.lockById(candidate.id);
          if (order?.status !== 'PENDING') {
            return false;
          }
          await transitionOrder(repositories, order, 'EXPIRED');
          return true;
        });
        (expired ? summary.expired : summary.alreadyHandled).push(candidate.id);
      } catch (error) {
        summary.failed.push({ orderId: candidate.id, error });
      }
    }
    return summary;
  }
}
