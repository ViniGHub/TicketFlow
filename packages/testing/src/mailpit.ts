import { GenericContainer, Wait } from 'testcontainers';

/** Mesma imagem do docker-compose.yml: o servidor SMTP de desenvolvimento. */
export const MAILPIT_IMAGE = 'axllent/mailpit:v1.31';

const SMTP_PORT = 1025;
const API_PORT = 8025;

/** Resumo de uma mensagem na API do Mailpit (`GET /api/v1/messages`). */
export interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Parte de uma mensagem: imagem embutida ou anexo. */
export interface MailpitPart {
  ContentType: string;
  ContentID: string;
  FileName: string;
}

/** Mensagem completa (`GET /api/v1/message/{ID}`). */
export interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string };
  To: { Address: string }[];
  HTML: string;
  Text: string;
  Inline: MailpitPart[];
  Attachments: MailpitPart[];
}

export interface StartedMailpit {
  smtpHost: string;
  smtpPort: number;
  /** Mensagens recebidas, as mais novas primeiro. */
  messages(): Promise<MailpitMessageSummary[]>;
  message(id: string): Promise<MailpitMessage>;
  /** Apaga todas as mensagens. */
  clear(): Promise<void>;
  stop(): Promise<void>;
}

/** Sobe o Mailpit: SMTP sem autenticação e a API HTTP para ler o que chegou. */
export async function startMailpit(): Promise<StartedMailpit> {
  const container = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(SMTP_PORT, API_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const apiUrl = `http://${container.getHost()}:${container.getMappedPort(API_PORT)}/api/v1`;

  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`Mailpit respondeu ${response.status} em ${path}.`);
    }
    return (await response.json()) as T;
  };

  return {
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(SMTP_PORT),
    messages: async () => (await api<{ messages: MailpitMessageSummary[] }>('/messages')).messages,
    message: (id) => api<MailpitMessage>(`/message/${id}`),
    clear: async () => {
      await fetch(`${apiUrl}/messages`, { method: 'DELETE' });
    },
    stop: async () => {
      await container.stop();
    },
  };
}
