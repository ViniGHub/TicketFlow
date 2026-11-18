'use client';

import { useEffect, useRef } from 'react';

import { cameraErrorMessage } from '../../lib/organizer/check-in';
import { decodeQr, insecureContextError } from '../../lib/organizer/qr';

/** Lado maior do quadro analisado: QR na porta fica grande na imagem, e menos pixels é mais rápido. */
const MAX_SIDE = 640;
/** Intervalo entre análises: o bastante para ler na hora sem esquentar o celular. */
const SCAN_EVERY_MS = 150;

export interface QrScannerProps {
  onScan: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Câmera traseira lendo QR codes. Para a câmera ao desmontar (fechar o leitor ou sair da
 * página): a luz de "câmera ligada" não pode ficar acesa à toa.
 */
export function QrScanner({ onScan, onError }: QrScannerProps) {
  const video = useRef<HTMLVideoElement>(null);
  // Os callbacks mudam a cada render; o laço da câmera lê sempre o mais novo.
  const handlers = useRef({ onScan, onError });
  useEffect(() => {
    handlers.current = { onScan, onError };
  }, [onScan, onError]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let lastScan = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const scan = async (now: number) => {
      const element = video.current;
      if (stopped || !element || !context) {
        return;
      }
      if (now - lastScan >= SCAN_EVERY_MS && element.readyState >= element.HAVE_ENOUGH_DATA) {
        lastScan = now;
        const scale = Math.min(1, MAX_SIDE / Math.max(element.videoWidth, element.videoHeight));
        canvas.width = Math.round(element.videoWidth * scale);
        canvas.height = Math.round(element.videoHeight * scale);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const text = await decodeQr(image.data, image.width, image.height);
        if (text && !stopped) {
          handlers.current.onScan(text);
        }
      }
      frame = requestAnimationFrame((time) => void scan(time));
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw insecureContextError();
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const element = video.current;
        if (stopped || !element) {
          return;
        }
        element.srcObject = stream;
        await element.play();
        frame = requestAnimationFrame((time) => void scan(time));
      } catch (error) {
        if (!stopped) {
          handlers.current.onError(cameraErrorMessage(error));
        }
      }
    };

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Imagem da câmera para ler o QR code"
      className="aspect-square w-full max-w-sm rounded-card bg-black object-cover"
    />
  );
}
