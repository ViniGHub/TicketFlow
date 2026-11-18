import { type OrderStatusValue } from '@ticketflow/contracts';

// Página do pedido (ROADMAP, etapa 6.2; ARCHITECTURE.md, seção 5, passo 5; ADR 0017). Ela só
// mostra o status gravado pela API: quem marca o pedido como pago é o webhook do Stripe. Voltar
// do Stripe pelo "sucesso" não prova pagamento nenhum.

export const POLL_INTERVAL_MS = 2_000;
/** Depois disso a página para de perguntar e avisa que a confirmação chega por e-mail. */
export const POLL_TIMEOUT_MS = 2 * 60_000;

/** De onde o comprador voltou do Stripe (`?checkout=`), se voltou. */
export type CheckoutReturn = 'success' | 'cancel' | null;

export type StatusTone = 'success' | 'pending' | 'info' | 'error';

export interface OrderStatusView {
  tone: StatusTone;
  title: string;
  message: string;
  /** Link para os ingressos. */
  showTickets: boolean;
  /** Botão para liberar a reserva (só pedido `PENDING`). */
  canCancel: boolean;
}

export function checkoutReturnOf(value: string | null): CheckoutReturn {
  return value === 'success' || value === 'cancel' ? value : null;
}

/** Status em que a página continua perguntando: o Stripe ainda pode mudar o pedido. */
export function isAwaitingPayment(status: OrderStatusValue): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

/** Intervalo do polling: 2 s enquanto o pedido espera o pagamento, até o limite. */
export function pollInterval(
  status: OrderStatusValue | undefined,
  timedOut: boolean,
): number | false {
  if (timedOut || (status !== undefined && !isAwaitingPayment(status))) {
    return false;
  }
  return POLL_INTERVAL_MS;
}

const view = (
  tone: StatusTone,
  title: string,
  message: string,
  extra: Partial<Pick<OrderStatusView, 'showTickets' | 'canCancel'>> = {},
): OrderStatusView => ({ tone, title, message, showTickets: false, canCancel: false, ...extra });

export function orderStatusView(
  status: OrderStatusValue,
  checkout: CheckoutReturn,
  timedOut: boolean,
): OrderStatusView {
  switch (status) {
    case 'PAID':
      return view(
        'success',
        'Pagamento confirmado',
        'Seus ingressos já estão na sua conta e também vão por e-mail.',
        { showTickets: true },
      );
    case 'PROCESSING':
      return view(
        timedOut ? 'info' : 'pending',
        'Aguardando a confirmação do pagamento',
        'O pagamento ainda está sendo processado. Assim que for aprovado, os ingressos aparecem na sua conta e vão por e-mail.',
      );
    case 'PENDING':
      if (checkout === 'cancel') {
        return view(
          'info',
          'Pagamento não concluído',
          'Os ingressos continuam reservados por alguns minutos. Se desistiu da compra, libere a reserva.',
          { canCancel: true },
        );
      }
      if (checkout === 'success') {
        return timedOut
          ? view(
              'info',
              'A confirmação está demorando',
              'Quando ela chegar, os ingressos aparecem na sua conta e vão por e-mail. Você pode fechar esta página.',
            )
          : view(
              'pending',
              'Confirmando o pagamento',
              'Estamos esperando a confirmação do Stripe. Isso costuma levar poucos segundos.',
            );
      }
      return view('info', 'Aguardando o pagamento', 'Os ingressos estão reservados para você.', {
        canCancel: true,
      });
    case 'EXPIRED':
      return view(
        'error',
        'Reserva expirada',
        'O prazo para pagar acabou e os ingressos voltaram à venda. Nada foi cobrado.',
      );
    case 'CANCELLED':
      return view('info', 'Pedido cancelado', 'A reserva foi liberada e nada foi cobrado.');
    case 'REFUND_PENDING':
      return view(
        'info',
        'Reembolso em andamento',
        'O valor vai ser devolvido na forma de pagamento usada na compra.',
      );
    case 'REFUNDED':
      return view(
        'info',
        'Pedido reembolsado',
        'O valor foi devolvido na forma de pagamento usada na compra.',
      );
  }
}
