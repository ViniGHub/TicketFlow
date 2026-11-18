import { type MyTicketResponse } from '@ticketflow/contracts';
import { describe, expect, it } from 'vitest';

import { qrDataUrl, toTicketView } from './view';

const ticket = (overrides: Partial<MyTicketResponse> = {}): MyTicketResponse => ({
  id: 't1',
  orderId: 'o1',
  // Valor de mentira, de baixa entropia: o QR só codifica o texto.
  qrToken: 'ingresso-de-teste-1',
  status: 'VALID',
  checkedInAt: null,
  voidedAt: null,
  ticketType: { id: 'l1', name: 'Pista' },
  event: {
    id: 'e1',
    title: 'Show',
    venue: 'Teatro',
    timezone: 'America/Sao_Paulo',
    startsAt: '2026-12-20T23:00:00.000Z',
  },
  ...overrides,
});

describe('toTicketView', () => {
  it('válido mostra o QR, com a data do evento no fuso dele', () => {
    const view = toTicketView(ticket());

    expect(view).toMatchObject({ statusLabel: 'Válido', tone: 'success', showQr: true });
    expect(view.eventDate).toContain('20:00');
  });

  it('usado diz quando entrou e não mostra mais o QR', () => {
    const view = toTicketView(ticket({ status: 'USED', checkedInAt: '2026-12-20T23:30:00.000Z' }));

    expect(view.showQr).toBe(false);
    expect(view.statusLabel).toMatch(/^Usado em .*20:30$/);
  });

  it('cancelado (reembolsado) não mostra o QR', () => {
    expect(toTicketView(ticket({ status: 'VOIDED' }))).toMatchObject({
      tone: 'danger',
      showQr: false,
    });
  });
});

describe('qrDataUrl', () => {
  it('gera uma imagem SVG com o QR do token', async () => {
    const url = await qrDataUrl('ingresso-de-teste-1');

    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('<svg');
  });
});
