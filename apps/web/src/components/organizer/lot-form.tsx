'use client';

import { type FormEvent, useState } from 'react';

import { messageFor } from '../../lib/api/errors';
import { useFormErrors } from '../../lib/forms/use-form-errors';
import { fieldErrorsFromApi } from '../../lib/forms/validate';
import {
  LOT_CODE_FIELDS,
  LOT_FIELDS,
  LOT_MESSAGES,
  type LotBody,
  lotBodyFrom,
  type LotFormValues,
  lotFormValuesFrom,
} from '../../lib/organizer/lots';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { Field } from '../ui/field';

export interface LotFormProps {
  initial: LotFormValues;
  /** Fuso do evento: as datas de venda são digitadas nele. */
  timeZone: string;
  submitLabel: string;
  /** Salva na API; se rejeitar, o erro aparece no formulário. */
  onSubmit: (body: LotBody) => Promise<unknown>;
  onCancel: () => void;
}

/** Um lote: nome, preço em reais, quantidade, limite por pedido e janela de vendas. */
export function LotForm({ initial, timeZone, submitLabel, onSubmit, onCancel }: LotFormProps) {
  const { errors, show, clearOnChange } = useFormErrors(LOT_FIELDS);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = lotBodyFrom(lotFormValuesFrom(new FormData(form)), timeZone);
    setFailure(null);
    show(form, result.ok ? {} : result.errors);
    if (!result.ok) {
      return;
    }
    setSaving(true);
    try {
      await onSubmit(result.body);
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error, LOT_MESSAGES, LOT_CODE_FIELDS);
      setFailure(Object.keys(fieldErrors).length > 0 ? null : error);
      show(form, fieldErrors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      onChange={clearOnChange}
      className="flex flex-col gap-4"
    >
      {failure !== null && <Alert tone="error">{messageFor(failure)}</Alert>}
      <Field
        label="Nome do lote"
        name="name"
        defaultValue={initial.name}
        placeholder="Ex.: Pista, Meia-entrada, 1º lote"
        error={errors.name}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Preço (R$)"
          name="priceCents"
          inputMode="decimal"
          defaultValue={initial.priceCents}
          placeholder="80,00"
          hint="0 para gratuito."
          error={errors.priceCents}
        />
        <Field
          label="Quantidade"
          name="total"
          inputMode="numeric"
          defaultValue={initial.total}
          error={errors.total}
        />
        <Field
          label="Limite por pedido"
          name="maxPerOrder"
          inputMode="numeric"
          defaultValue={initial.maxPerOrder}
          error={errors.maxPerOrder}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Início das vendas"
          name="salesStart"
          type="datetime-local"
          defaultValue={initial.salesStart}
          error={errors.salesStart}
        />
        <Field
          label="Fim das vendas"
          name="salesEnd"
          type="datetime-local"
          defaultValue={initial.salesEnd}
          hint="No horário do evento, até o início dele."
          error={errors.salesEnd}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
