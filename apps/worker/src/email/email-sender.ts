import { createTransport } from 'nodemailer';

import { type EmailMessage } from './email-message';

// Transporte do e-mail (ROADMAP, etapa 5.2; ADR 0013): SMTP em desenvolvimento (Mailpit) e a
// API do Resend em produção. O consumidor depende só de EmailSender.

export interface EmailSender {
  /** Entrega a mensagem ou lança erro; quem chama decide se tenta de novo. */
  send(message: EmailMessage): Promise<void>;
  close?(): void;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Nome que aparece como remetente. */
export const SENDER_NAME = 'TicketFlow';

/** O que o SmtpEmailSender usa do nodemailer; os testes passam um de mentira. */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments: { filename: string; content: Buffer; contentType: string; cid: string }[];
  }): Promise<unknown>;
  close(): void;
}

/** Endereço no formato `Nome <email>`, com o nome entre aspas para não quebrar o cabeçalho. */
export function mailbox(name: string, email: string): string {
  return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${email}>`;
}

/** SMTP pelo nodemailer: o Mailpit em desenvolvimento, sem autenticação. */
export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  static create({ host, port, from }: { host: string; port: number; from: string }) {
    return new SmtpEmailSender(createTransport({ host, port, secure: port === 465 }), from);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: mailbox(SENDER_NAME, this.from),
      to: mailbox(message.to.name, message.to.email),
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.images.map(({ filename, content, contentType, contentId }) => ({
        filename,
        content,
        contentType,
        cid: contentId,
      })),
    });
  }

  close(): void {
    this.transport.close();
  }
}

export const RESEND_API_URL = 'https://api.resend.com/emails';

/** Tempo máximo de uma chamada ao Resend: o job tenta de novo depois, com backoff. */
export const RESEND_TIMEOUT_MS = 10_000;

/**
 * API HTTP do Resend, em produção. O `Idempotency-Key` faz o Resend descartar, por 24 h, um
 * segundo envio do mesmo pedido: cobre o job que enviou e caiu antes de gravar `emailed_at`.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchFn(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: mailbox(SENDER_NAME, this.from),
        to: [mailbox(message.to.name, message.to.email)],
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.images.map(({ filename, content, contentType, contentId }) => ({
          filename,
          content: content.toString('base64'),
          content_type: contentType,
          content_id: contentId,
        })),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // A mensagem de erro do Resend ajuda a diagnosticar; a chave nunca entra no erro.
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend respondeu ${response.status}: ${detail.slice(0, 300)}`);
    }
  }
}

export interface EmailSenderConfig {
  from: string;
  smtp: { host: string; port: number };
  /** Com a chave, o Resend; sem ela, SMTP. */
  resendApiKey?: string;
}

export function createEmailSender({ from, smtp, resendApiKey }: EmailSenderConfig): EmailSender {
  return resendApiKey
    ? new ResendEmailSender(resendApiKey, from)
    : SmtpEmailSender.create({ ...smtp, from });
}
