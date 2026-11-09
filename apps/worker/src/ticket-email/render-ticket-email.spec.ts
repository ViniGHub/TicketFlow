import { describe, expect, it } from 'vitest';

import {
  contentIdOf,
  renderTicketEmail,
  type TicketEmailEvent,
  type TicketEmailTicket,
} from './render-ticket-email';

// Tokens de mentira, de baixa entropia: o render não valida o formato.
const show: TicketEmailEvent = {
  id: 'evento-1',
  title: 'Show de Teste',
  venue: 'Teatro Municipal',
  // 23:00 UTC = 20:00 em São Paulo (UTC-3).
  startsAt: new Date('2026-12-20T23:00:00Z'),
  timezone: 'America/Sao_Paulo',
};

function ticket(id: string, event = show, ticketTypeName = 'Pista'): TicketEmailTicket {
  return { id, qrToken: `token-do-${id}`, ticketTypeName, event };
}

const fakeQr = (token: string) => Promise.resolve(Buffer.from(`png:${token}`));

describe('e-mail de ingressos', () => {
  it('um ingresso: assunto, destinatário, QR embutido e chave de idempotência do pedido', async () => {
    const message = await renderTicketEmail(
      {
        orderId: 'pedido-1',
        buyer: { name: 'Ana', email: 'ana@exemplo.com' },
        tickets: [ticket('ingresso-a')],
      },
      fakeQr,
    );

    expect(message.subject).toBe('Seu ingresso para Show de Teste');
    expect(message.to).toEqual({ email: 'ana@exemplo.com', name: 'Ana' });
    expect(message.idempotencyKey).toBe('send-ticket-email:pedido-1');
    expect(message.images).toEqual([
      {
        contentId: contentIdOf('ingresso-a'),
        filename: 'ingresso-1.png',
        contentType: 'image/png',
        content: Buffer.from('png:token-do-ingresso-a'),
      },
    ]);
    expect(message.html).toContain(`src="cid:${contentIdOf('ingresso-a')}"`);
  });

  it('N ingressos: uma imagem por ingresso, com a posição de cada um', async () => {
    const message = await renderTicketEmail(
      {
        orderId: 'pedido-1',
        buyer: { name: 'Ana', email: 'ana@exemplo.com' },
        tickets: [ticket('a'), ticket('b'), ticket('c', show, 'VIP')],
      },
      fakeQr,
    );

    expect(message.subject).toBe('Seus ingressos para Show de Teste');
    expect(message.images.map((image) => image.filename)).toEqual([
      'ingresso-1.png',
      'ingresso-2.png',
      'ingresso-3.png',
    ]);
    expect(message.html).toContain('ingresso 3 de 3');
    expect(message.text).toContain('VIP, ingresso 3 de 3: código token-do-c');
  });

  it('data e hora no fuso do evento, no HTML e no texto', async () => {
    const message = await renderTicketEmail(
      {
        orderId: 'pedido-1',
        buyer: { name: 'Ana', email: 'ana@exemplo.com' },
        tickets: [ticket('a')],
      },
      fakeQr,
    );

    expect(message.html).toContain('20 de dezembro de 2026');
    expect(message.html).toContain('20:00');
    expect(message.text).toContain('20 de dezembro de 2026');
  });

  it('o que vem do organizador e do comprador não vira HTML', async () => {
    const hostile = { ...show, title: '<script>alert(1)</script>', venue: 'Bar & "Cia"' };

    const message = await renderTicketEmail(
      {
        orderId: 'pedido-1',
        buyer: { name: '<b>Ana</b>', email: 'ana@exemplo.com' },
        tickets: [ticket('a', hostile, "Lote <img src='x'>")],
      },
      fakeQr,
    );

    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<b>Ana</b>');
    expect(message.html).not.toContain("<img src='x'>");
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('Bar &amp; &quot;Cia&quot;');
  });

  it('pedido com dois eventos: agrupa por evento, em ordem de data', async () => {
    const earlier = {
      ...show,
      id: 'evento-0',
      title: 'Abertura',
      startsAt: new Date('2026-12-01T22:00:00Z'),
    };

    const message = await renderTicketEmail(
      {
        orderId: 'pedido-1',
        buyer: { name: 'Ana', email: 'ana@exemplo.com' },
        tickets: [ticket('a'), ticket('b', earlier)],
      },
      fakeQr,
    );

    expect(message.subject).toBe('Seus ingressos para 2 eventos');
    expect(message.html.indexOf('Abertura')).toBeLessThan(message.html.indexOf('Show de Teste'));
  });
});
