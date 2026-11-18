// Leitura do QR code de um quadro da câmera (ROADMAP, etapa 6.3). O jsQR só carrega quando a
// câmera abre: quem digita o código não baixa o decodificador.

/** O texto do QR code na imagem RGBA, ou `null` se não há um legível. */
export async function decodeQr(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const code = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  return code?.data ? code.data : null;
}

/** Erro com o nome que a tela entende, para o navegador sem câmera em contexto inseguro. */
export function insecureContextError(): Error {
  const error = new Error('mediaDevices indisponível');
  error.name = 'InsecureContext';
  return error;
}
