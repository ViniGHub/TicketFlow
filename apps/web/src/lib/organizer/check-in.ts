import { checkInRequestSchema } from '@ticketflow/contracts';

import { ApiError, messageFor } from '../api/errors';

// Check-in na porta do evento (ROADMAP, etapa 6.3; ADR 0018). Quem decide é a API: a tela só
// traduz a resposta num resultado grande, que se lê de longe, com ícone e texto (nunca só cor).

export type CheckInTone = 'success' | 'danger' | 'neutral';

export interface CheckInResult {
  tone: CheckInTone;
  title: string;
  detail: string;
}

/** O texto lido (câmera ou campo) como token, ou `null` se não tem cara de ingresso. */
export function qrTokenOf(text: string): string | null {
  const parsed = checkInRequestSchema.safeParse({ qrToken: text.trim() });
  return parsed.success ? parsed.data.qrToken : null;
}

export const INVALID_CODE: CheckInResult = {
  tone: 'danger',
  title: 'Código inválido',
  detail: 'Isto não é um ingresso do TicketFlow.',
};

export function acceptedResult(ticketTypeName: string): CheckInResult {
  return { tone: 'success', title: 'Entrada liberada', detail: `Lote: ${ticketTypeName}` };
}

const REFUSALS: Readonly<Record<string, CheckInResult>> = {
  TICKET_ALREADY_USED: {
    tone: 'danger',
    title: 'Já usado',
    detail: 'Este ingresso já passou pela entrada.',
  },
  TICKET_VOIDED: {
    tone: 'danger',
    title: 'Cancelado (reembolsado)',
    detail: 'O pedido deste ingresso foi reembolsado.',
  },
  TICKET_FROM_OTHER_EVENT: {
    tone: 'danger',
    title: 'De outro evento',
    detail: 'Este ingresso não é deste evento.',
  },
  TICKET_NOT_FOUND: {
    tone: 'danger',
    title: 'Não encontrado',
    detail: 'Nenhum ingresso com este código.',
  },
};

/** A recusa da API como resultado; falha de rede ou do servidor não é recusa: tente de novo. */
export function refusedResult(error: unknown): CheckInResult {
  const refusal = error instanceof ApiError ? REFUSALS[error.code] : undefined;
  return refusal ?? { tone: 'neutral', title: 'Não deu para validar', detail: messageFor(error) };
}

/** A câmera lê o mesmo QR várias vezes por segundo: repetição dentro da janela é ignorada. */
export const REPEAT_WINDOW_MS = 3_000;

export function isRepeatedScan(
  token: string,
  last: { token: string; at: number } | null,
  now: number,
): boolean {
  return last !== null && last.token === token && now - last.at < REPEAT_WINDOW_MS;
}

/** O motivo de a câmera não abrir, para quem está na porta. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Permita o uso da câmera no navegador para ler o QR code.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada neste aparelho.';
    case 'NotReadableError':
      return 'A câmera está em uso por outro aplicativo.';
    case 'InsecureContext':
      return 'A câmera só funciona com o site em HTTPS.';
    default:
      return 'Não foi possível abrir a câmera. Digite o código do ingresso.';
  }
}
