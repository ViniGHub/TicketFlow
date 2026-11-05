import { type ExpireCheckoutSessionResult, type SessionExpirer } from '@ticketflow/domain';

/** Token de injeção do `SessionExpirer` usado pelo cancelamento e pela expiração. */
export const SESSION_EXPIRER = Symbol('SESSION_EXPIRER');

/**
 * Implementação nula (ROADMAP, etapa 3.3). Até a etapa 4.1 nenhum pedido tem sessão no
 * Stripe, então o domínio nem chega a chamá-la. A 4.1 troca este provider pelo gateway do
 * Stripe.
 */
export class NullSessionExpirer implements SessionExpirer {
  expireCheckoutSession(): Promise<ExpireCheckoutSessionResult> {
    return Promise.resolve('expired');
  }
}
