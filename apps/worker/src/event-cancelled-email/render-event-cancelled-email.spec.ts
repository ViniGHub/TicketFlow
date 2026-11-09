import { describe, expect, it } from 'vitest';

import {
  type CancelledEvent,
  type EventCancelledEmailInput,
  renderEventCancelledEmail,
} from './render-event-cancelled-email';

const ORDER_ID = '0193a4f2-0000-7000-8000-000000000001';

const show: CancelledEvent = {
  title: 'Show de Teste',
  venue: 'Teatro Municipal',
  startsAt: new Date('2026-12-20T23:00:00Z'),
  timezone: 'America/Sao_Paulo',
};

function render(overrides: Partial<EventCancelledEmailInput> = {}) {
  return renderEventCancelledEmail({
    orderId: ORDER_ID,
    buyer: { name: 'Ana Compradora', email: 'ana@teste.local' },
    events: [show],
    ticketCount: 2,
    refundCents: 16_000,
    ...overrides,
  });
}

describe('e-mail de evento cancelado', () => {
  it('diz qual evento foi cancelado, que os ingressos não valem e quanto volta', () => {
    const message = render();

    expect(message.to).toEqual({ email: 'ana@teste.local', name: 'Ana Compradora' });
    expect(message.subject).toBe('Evento cancelado: Show de Teste');
    expect(message.text).toContain('Show de Teste');
    expect(message.text).toContain('20:00');
    expect(message.text).toContain('Teatro Municipal');
    expect(message.text).toContain('Os 2 ingressos do seu pedido foram cancelados');
    expect(message.text).toContain('R$ 160,00');
    expect(message.text).toContain(`Pedido ${ORDER_ID}`);
    expect(message.images).toEqual([]);
  });

  it('a chave de idempotência é a do job e do pedido', () => {
    expect(render().idempotencyKey).toBe(`send-event-cancelled-email:${ORDER_ID}`);
  });

  it('pedido sem cobrança não promete devolução', () => {
    const message = render({ refundCents: 0 });

    expect(message.text).toContain('não há valor a devolver');
    expect(message.text).not.toContain('R$');
  });

  it('um ingresso só, no singular', () => {
    expect(render({ ticketCount: 1 }).text).toContain('O ingresso do seu pedido foi cancelado');
  });

  it('pedido com dois eventos cancelados lista os dois', () => {
    const opening = { ...show, title: 'Abertura', startsAt: new Date('2026-12-19T23:00:00Z') };

    const message = render({ events: [opening, show] });

    expect(message.subject).toBe('2 eventos do seu pedido foram cancelados');
    expect(message.text).toContain('- Abertura');
    expect(message.text).toContain('- Show de Teste');
  });

  it('título, local e nome não viram HTML', () => {
    const message = render({
      buyer: { name: '<b>Ana</b>', email: 'ana@teste.local' },
      events: [{ ...show, title: 'Show <script>' }],
    });

    expect(message.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(message.html).toContain('Show &lt;script&gt;');
    expect(message.html).not.toContain('<script>');
  });
});
