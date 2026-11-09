import { describe, expect, it, vi } from 'vitest';

import { type EmailMessage } from './email-message';
import {
  createEmailSender,
  mailbox,
  type MailTransport,
  RESEND_API_URL,
  ResendEmailSender,
  SmtpEmailSender,
} from './email-sender';

// Chave de mentira, de baixa entropia: os testes nunca falam com o Resend.
const API_KEY = 're_chave_de_teste';
const FROM = 'ingressos@ticketflow.local';

const message: EmailMessage = {
  to: { email: 'ana@exemplo.com', name: 'Ana' },
  subject: 'Seu ingresso para Show de Teste',
  html: '<p>oi</p>',
  text: 'oi',
  images: [
    {
      contentId: 'ingresso-1@ticketflow',
      filename: 'ingresso-1.png',
      contentType: 'image/png',
      content: Buffer.from('png-de-mentira'),
    },
  ],
  idempotencyKey: 'send-ticket-email:pedido-1',
};

describe('SMTP', () => {
  it('envia com o remetente, o destinatário e os QR como imagens embutidas', async () => {
    const sendMail = vi.fn((_options: Parameters<MailTransport['sendMail']>[0]) =>
      Promise.resolve({}),
    );
    const sender = new SmtpEmailSender({ sendMail, close: vi.fn() }, FROM);

    await sender.send(message);

    expect(sendMail).toHaveBeenCalledWith({
      from: `"TicketFlow" <${FROM}>`,
      to: '"Ana" <ana@exemplo.com>',
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [
        {
          filename: 'ingresso-1.png',
          content: Buffer.from('png-de-mentira'),
          contentType: 'image/png',
          cid: 'ingresso-1@ticketflow',
        },
      ],
    });
  });

  it('erro do servidor SMTP sobe, para o job tentar de novo', async () => {
    const sender = new SmtpEmailSender(
      { sendMail: () => Promise.reject(new Error('ECONNREFUSED')), close: vi.fn() },
      FROM,
    );

    await expect(sender.send(message)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('Resend', () => {
  function fakeFetch(status = 200, body = '{"id":"email-1"}') {
    return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(body, { status })),
    );
  }

  it('faz o POST com a chave, o Idempotency-Key do pedido e os anexos embutidos', async () => {
    const fetchFn = fakeFetch();
    const sender = new ResendEmailSender(API_KEY, FROM, fetchFn);

    await sender.send(message);

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_API_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      'Idempotency-Key': 'send-ticket-email:pedido-1',
    });
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      from: `"TicketFlow" <${FROM}>`,
      to: ['"Ana" <ana@exemplo.com>'],
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [
        {
          filename: 'ingresso-1.png',
          content: Buffer.from('png-de-mentira').toString('base64'),
          content_type: 'image/png',
          content_id: 'ingresso-1@ticketflow',
        },
      ],
    });
  });

  it('resposta que não é 2xx vira erro, sem a chave na mensagem', async () => {
    const sender = new ResendEmailSender(
      API_KEY,
      FROM,
      fakeFetch(503, '{"message":"indisponível"}'),
    );

    const result = sender.send(message);

    await expect(result).rejects.toThrow(/Resend respondeu 503/);
    await expect(result).rejects.not.toThrow(API_KEY);
  });
});

describe('escolha do transporte', () => {
  it('com a chave do Resend, usa o Resend; sem ela, SMTP', () => {
    const smtp = { host: 'localhost', port: 1025 };

    expect(createEmailSender({ from: FROM, smtp, resendApiKey: API_KEY })).toBeInstanceOf(
      ResendEmailSender,
    );
    const viaSmtp = createEmailSender({ from: FROM, smtp });
    expect(viaSmtp).toBeInstanceOf(SmtpEmailSender);
    viaSmtp.close?.();
  });

  it('nome com aspas não quebra o cabeçalho do endereço', () => {
    expect(mailbox('Ana "A" Silva', 'ana@exemplo.com')).toBe(
      '"Ana \\"A\\" Silva" <ana@exemplo.com>',
    );
  });
});
