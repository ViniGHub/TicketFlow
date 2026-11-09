import { toBuffer } from 'qrcode';

/** Lado do QR em pixels: legível na tela do celular e impresso. */
export const QR_CODE_SIZE_PX = 480;

/**
 * PNG do QR de um ingresso. O QR codifica só o `qr_token`, o que o check-in recebe
 * (ARCHITECTURE.md, seção 9). Correção de erro média: aguenta tela riscada ou trincada.
 */
export function qrCodePng(qrToken: string): Promise<Buffer> {
  return toBuffer(qrToken, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: QR_CODE_SIZE_PX,
  });
}
