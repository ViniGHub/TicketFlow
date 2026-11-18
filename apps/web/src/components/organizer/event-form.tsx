'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';

import { messageFor } from '../../lib/api/errors';
import { timeZoneOptions } from '../../lib/forms/zoned-time';
import { useFormErrors } from '../../lib/forms/use-form-errors';
import { fieldErrorsFromApi } from '../../lib/forms/validate';
import {
  type EventBody,
  EVENT_CODE_FIELDS,
  EVENT_FIELDS,
  EVENT_MESSAGES,
  type EventFormValues,
  eventBodyFrom,
  eventFormValuesFrom,
} from '../../lib/organizer/events';
import { Alert } from '../ui/alert';
import { Button, buttonClasses } from '../ui/button';
import { Field, SelectField, TextAreaField } from '../ui/field';

export interface EventFormProps {
  initial: EventFormValues;
  submitLabel: string;
  cancelHref: string;
  /** Salva na API; se rejeitar, o erro aparece no formulário. */
  onSubmit: (body: EventBody) => Promise<unknown>;
}

/** Dados do evento: os mesmos campos para criar e para editar (ROADMAP, etapa 6.3). */
export function EventForm({ initial, submitLabel, cancelHref, onSubmit }: EventFormProps) {
  const { errors, show, clearOnChange } = useFormErrors(EVENT_FIELDS);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = eventBodyFrom(eventFormValuesFrom(new FormData(form)));
    setFailure(null);
    show(form, result.ok ? {} : result.errors);
    if (!result.ok) {
      return;
    }
    setSaving(true);
    try {
      await onSubmit(result.body);
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error, EVENT_MESSAGES, EVENT_CODE_FIELDS);
      // Erro de um campo aparece nele; o resto, no alerta do topo.
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
      <Field label="Título" name="title" defaultValue={initial.title} error={errors.title} />
      <TextAreaField
        label="Descrição"
        name="description"
        defaultValue={initial.description}
        hint="Opcional. Aparece na página do evento."
        error={errors.description}
      />
      <Field
        label="Local"
        name="venue"
        defaultValue={initial.venue}
        placeholder="Ex.: Teatro Municipal, São Paulo"
        error={errors.venue}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Fuso do evento"
          name="timezone"
          defaultValue={initial.timezone}
          options={timeZoneOptions(initial.timezone)}
          error={errors.timezone}
        />
        <Field
          label="Data e hora"
          name="startsAt"
          type="datetime-local"
          defaultValue={initial.startsAt}
          hint="No horário do local do evento."
          error={errors.startsAt}
        />
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses('ghost')}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
