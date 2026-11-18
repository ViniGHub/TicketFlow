import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '../api/errors';

import {
  acceptedResult,
  cameraErrorMessage,
  INVALID_CODE,
  isRepeatedScan,
  qrTokenOf,
  REPEAT_WINDOW_MS,
  refusedResult,
} from './check-in';
import { decodeQr } from './qr';

// Placeholder de baixa entropia no formato do token (43 caracteres base64url).
const TOKEN = `${'teste_'.repeat(7)}a`;

const refusal = (status: number, code: string) => new ApiError(status, code, 'x', [], true);

describe('qrTokenOf', () => {
  it('aceita o token com espaços em volta (leitor USB, colar)', () => {
    expect(qrTokenOf(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it.each(['', 'https://exemplo.com/ingresso', TOKEN.slice(1), `${TOKEN}!`])(
    'recusa %j',
    (text) => {
      expect(qrTokenOf(text)).toBeNull();
    },
  );
});

describe('resultado da leitura', () => {
  it('entrada liberada mostra o lote', () => {
    expect(acceptedResult('Pista')).toEqual({
      tone: 'success',
      title: 'Entrada liberada',
      detail: 'Lote: Pista',
    });
  });

  it.each([
    [409, 'TICKET_ALREADY_USED', 'Já usado'],
    [409, 'TICKET_VOIDED', 'Cancelado (reembolsado)'],
    [422, 'TICKET_FROM_OTHER_EVENT', 'De outro evento'],
    [404, 'TICKET_NOT_FOUND', 'Não encontrado'],
  ])('%i %s: recusado como "%s"', (status, code, title) => {
    expect(refusedResult(refusal(status, code))).toMatchObject({ tone: 'danger', title });
  });

  it('falha de rede não é recusa: pede para tentar de novo', () => {
    expect(refusedResult(networkError())).toMatchObject({
      tone: 'neutral',
      title: 'Não deu para validar',
    });
  });

  it('código que não é ingresso tem resultado próprio', () => {
    expect(INVALID_CODE.tone).toBe('danger');
  });
});

describe('isRepeatedScan', () => {
  it('o mesmo QR dentro da janela é ignorado; depois dela, ou outro QR, passa', () => {
    const last = { token: TOKEN, at: 1_000 };

    expect(isRepeatedScan(TOKEN, last, 1_000 + REPEAT_WINDOW_MS - 1)).toBe(true);
    expect(isRepeatedScan(TOKEN, last, 1_000 + REPEAT_WINDOW_MS)).toBe(false);
    expect(isRepeatedScan('outro', last, 1_001)).toBe(false);
    expect(isRepeatedScan(TOKEN, null, 1_001)).toBe(false);
  });
});

describe('cameraErrorMessage', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name });

  it('explica a permissão negada e a falta de câmera', () => {
    expect(cameraErrorMessage(named('NotAllowedError'))).toContain('Permita o uso da câmera');
    expect(cameraErrorMessage(named('NotFoundError'))).toContain('Nenhuma câmera');
    expect(cameraErrorMessage(named('InsecureContext'))).toContain('HTTPS');
    expect(cameraErrorMessage('?')).toContain('Digite o código');
  });
});

describe('decodeQr', () => {
  /** O QR do ingresso como imagem RGBA, do jeito que um quadro da câmera chega. */
  function qrImage(text: string, scale = 4, margin = 4) {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const side = (modules.size + margin * 2) * scale;
    const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const row = Math.floor(y / scale) - margin;
        const col = Math.floor(x / scale) - margin;
        const inside = row >= 0 && col >= 0 && row < modules.size && col < modules.size;
        if (inside && modules.get(row, col)) {
          rgba.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3);
        }
      }
    }
    return { rgba, side };
  }

  it('lê o token do QR gerado como o do ingresso', async () => {
    const { rgba, side } = qrImage(TOKEN);

    expect(await decodeQr(rgba, side, side)).toBe(TOKEN);
  });

  it('imagem sem QR: null', async () => {
    expect(await decodeQr(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});
