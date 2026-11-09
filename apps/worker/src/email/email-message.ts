// Mensagem de e-mail independente do transporte (SMTP ou Resend).

/** Imagem embutida no HTML (`<img src="cid:...">`); os clientes também a mostram como anexo. */
export interface EmailImage {
  contentId: string;
  filename: string;
  contentType: 'image/png';
  content: Buffer;
}

export interface EmailMessage {
  to: { email: string; name: string };
  subject: string;
  html: string;
  /** Versão em texto puro, para clientes que não mostram HTML nem imagens. */
  text: string;
  images: EmailImage[];
  /**
   * Chave de idempotência: o transporte que a suporta (Resend) descarta um segundo envio com
   * a mesma chave. Ex.: `send-ticket-email:<orderId>`.
   */
  idempotencyKey: string;
}
