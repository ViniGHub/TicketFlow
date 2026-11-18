import { orderStatusSchema } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { checkoutReturnOf, orderStatusView, POLL_INTERVAL_MS, pollInterval } from './status';

describe('pollInterval', () => {
  it('pergunta a cada 2 s enquanto o pedido espera o pagamento', () => {
    expect(pollInterval(undefined, false)).toBe(POLL_INTERVAL_MS);
    expect(pollInterval('PENDING', false)).toBe(POLL_INTERVAL_MS);
    expect(pollInterval('PROCESSING', false)).toBe(POLL_INTERVAL_MS);
  });

  it('para quando o pedido chega a um estado final ou o tempo acaba', () => {
    expect(pollInterval('PAID', false)).toBe(false);
    expect(pollInterval('EXPIRED', false)).toBe(false);
    expect(pollInterval('PENDING', true)).toBe(false);
  });
});

describe('orderStatusView', () => {
  it('voltar do Stripe pelo sucesso não basta: PENDING continua "confirmando"', () => {
    const view = orderStatusView('PENDING', 'success', false);

    expect(view).toMatchObject({ tone: 'pending', title: 'Confirmando o pagamento' });
    expect(view.showTickets).toBe(false);
  });

  it('depois do limite, avisa que a confirmação chega por e-mail, sem dar como pago', () => {
    expect(orderStatusView('PENDING', 'success', true)).toMatchObject({
      tone: 'info',
      title: 'A confirmação está demorando',
      showTickets: false,
    });
  });

  it('PROCESSING é "aguardando confirmação"', () => {
    expect(orderStatusView('PROCESSING', 'success', false).title).toBe(
      'Aguardando a confirmação do pagamento',
    );
  });

  it('só PAID mostra os ingressos', () => {
    expect(orderStatusView('PAID', 'success', false)).toMatchObject({
      tone: 'success',
      showTickets: true,
    });
  });

  it('quem voltou pelo cancelar pode liberar a reserva', () => {
    expect(orderStatusView('PENDING', 'cancel', false)).toMatchObject({
      title: 'Pagamento não concluído',
      canCancel: true,
    });
  });

  it('todo status tem título e mensagem', () => {
    for (const status of orderStatusSchema.options) {
      const view = orderStatusView(status, null, false);
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.message.length).toBeGreaterThan(0);
    }
  });

  it('?checkout= só aceita success ou cancel', () => {
    expect(checkoutReturnOf('success')).toBe('success');
    expect(checkoutReturnOf('outra-coisa')).toBeNull();
    expect(checkoutReturnOf(null)).toBeNull();
  });
});
