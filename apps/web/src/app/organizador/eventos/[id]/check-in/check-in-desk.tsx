'use client';

import { useMutation } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Alert } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Card } from '../../../../../components/ui/card';
import { cn } from '../../../../../components/ui/cn';
import { Field } from '../../../../../components/ui/field';
import { api, unwrap } from '../../../../../lib/api/client';
import {
  acceptedResult,
  type CheckInResult,
  type CheckInTone,
  INVALID_CODE,
  isRepeatedScan,
  qrTokenOf,
  refusedResult,
} from '../../../../../lib/organizer/check-in';
import { useMyEvent } from '../../../../../lib/organizer/queries';
import { useRequiredSession } from '../../../../../lib/session/use-required-session';

// A câmera só existe no navegador e só carrega quando o organizador abre o leitor.
const QrScanner = dynamic(
  () => import('../../../../../components/organizer/qr-scanner').then((mod) => mod.QrScanner),
  { ssr: false },
);

const TONES: Record<CheckInTone, { box: string; icon: string }> = {
  success: { box: 'border-success bg-success-soft text-success', icon: '✓' },
  danger: { box: 'border-danger bg-danger-soft text-danger', icon: '✕' },
  neutral: { box: 'border-line bg-surface-muted text-text', icon: '!' },
};

/** Leitura na porta: o código digitado (ou de um leitor USB, que digita e tecla Enter) ou a câmera. */
export function CheckInDesk({ eventId }: { eventId: string }) {
  useRequiredSession();
  const event = useMyEvent(eventId);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const lastScan = useRef<{ token: string; at: number } | null>(null);
  const [result, setResult] = useState<{ value: CheckInResult; at: Date } | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const checkIn = useMutation({
    mutationFn: (qrToken: string) =>
      unwrap(
        api.POST('/events/{id}/check-in', { params: { path: { id: eventId } }, body: { qrToken } }),
      ),
  });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const show = (value: CheckInResult, fromCamera: boolean) => {
    setResult({ value, at: new Date() });
    if (input.current) {
      input.current.value = '';
      // Com a câmera, o foco no campo abriria o teclado do celular por cima da imagem.
      if (!fromCamera) {
        input.current.focus();
      }
    }
  };

  const validate = (text: string, fromCamera: boolean) => {
    const token = qrTokenOf(text);
    if (!token) {
      show(INVALID_CODE, fromCamera);
      return;
    }
    if (busy.current) {
      return;
    }
    busy.current = true;
    checkIn.mutate(token, {
      onSuccess: (accepted) => show(acceptedResult(accepted.ticketType.name), fromCamera),
      onError: (error) => show(refusedResult(error), fromCamera),
      onSettled: () => {
        busy.current = false;
      },
    });
  };

  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    validate(input.current?.value ?? '', false);
  };

  // O leitor guarda os callbacks numa ref: recriá-los a cada render não reinicia a câmera.
  const onScan = (text: string) => {
    const now = Date.now();
    const token = text.trim();
    if (busy.current || isRepeatedScan(token, lastScan.current, now)) {
      return;
    }
    lastScan.current = { token, at: now };
    validate(token, true);
  };

  const onCameraError = (message: string) => {
    setCamera(false);
    setCameraError(message);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={`/organizador/eventos/${eventId}`} className="text-sm font-medium text-brand">
          ← {event.data?.title ?? 'Voltar ao evento'}
        </Link>
        <h1 className="text-2xl font-bold">Check-in</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-4">
          <form noValidate onSubmit={submit} className="flex flex-col gap-3">
            <Field
              ref={input}
              label="Código do ingresso"
              name="qrToken"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              hint="Digite o código ou use um leitor que tecle Enter no fim."
            />
            <Button type="submit" loading={checkIn.isPending}>
              Validar
            </Button>
          </form>
          <div className="flex flex-col items-start gap-3 border-t border-line pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setCameraError(null);
                setCamera((open) => !open);
              }}
            >
              {camera ? 'Fechar a câmera' : 'Ler com a câmera'}
            </Button>
            {cameraError && <Alert tone="error">{cameraError}</Alert>}
            {camera && <QrScanner onScan={onScan} onError={onCameraError} />}
          </div>
        </Card>

        <ResultPanel result={result} />
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: { value: CheckInResult; at: Date } | null }) {
  if (!result) {
    return (
      <div
        role="status"
        className="flex min-h-56 items-center justify-center rounded-card border border-dashed border-line p-8 text-center text-muted"
      >
        O resultado de cada leitura aparece aqui, grande, para ler de longe.
      </div>
    );
  }
  const tone = TONES[result.value.tone];
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        'flex min-h-56 flex-col items-center justify-center gap-3 rounded-card border-2 p-8 text-center',
        tone.box,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full border-4 border-current text-3xl font-bold"
      >
        {tone.icon}
      </span>
      <p className="text-3xl font-bold">{result.value.title}</p>
      <p className="text-lg">{result.value.detail}</p>
      <p className="text-sm opacity-80">Lido às {result.at.toLocaleTimeString('pt-BR')}</p>
    </div>
  );
}
