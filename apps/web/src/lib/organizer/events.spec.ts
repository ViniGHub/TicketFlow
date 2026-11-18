import { describe, expect, it } from 'vitest';

import {
  EMPTY_EVENT,
  EVENT_MESSAGES,
  eventBodyFrom,
  eventFormValuesFrom,
  eventFormValuesOf,
} from './events';

const filled = {
  ...EMPTY_EVENT,
  title: '  Jazz no Parque ',
  venue: 'Parque Ibirapuera',
  timezone: 'America/Manaus',
  startsAt: '2026-12-20T20:00',
};

describe('eventBodyFrom', () => {
  it('a data digitada vale no fuso escolhido e vai em ISO UTC para a API', () => {
    expect(eventBodyFrom(filled)).toEqual({
      ok: true,
      body: {
        title: 'Jazz no Parque',
        description: '',
        venue: 'Parque Ibirapuera',
        timezone: 'America/Manaus',
        startsAt: '2026-12-21T00:00:00.000Z',
      },
    });
  });

  it('formulário vazio: cada campo obrigatório com a sua mensagem', () => {
    const result = eventBodyFrom(EMPTY_EVENT);

    expect(result).toEqual({
      ok: false,
      errors: {
        title: EVENT_MESSAGES.title,
        venue: EVENT_MESSAGES.venue,
        startsAt: EVENT_MESSAGES.startsAt,
      },
    });
  });

  it('descrição longa demais e fuso desconhecido são recusados', () => {
    const result = eventBodyFrom({
      ...filled,
      description: 'x'.repeat(5_001),
      timezone: 'Marte/Olympus',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toMatchObject({
      description: EVENT_MESSAGES.description,
      timezone: EVENT_MESSAGES.timezone,
    });
  });
});

describe('valores do formulário', () => {
  it('lê os campos do FormData, com texto vazio para o que faltar', () => {
    const form = new FormData();
    form.set('title', 'Jazz');
    form.set('timezone', 'America/Sao_Paulo');

    expect(eventFormValuesFrom(form)).toEqual({
      title: 'Jazz',
      description: '',
      venue: '',
      timezone: 'America/Sao_Paulo',
      startsAt: '',
    });
  });

  it('o evento salvo volta ao formulário com a hora no fuso dele', () => {
    expect(
      eventFormValuesOf({
        title: 'Jazz',
        description: 'Ao ar livre',
        venue: 'Parque',
        timezone: 'America/Manaus',
        startsAt: '2026-12-21T00:00:00.000Z',
      }),
    ).toMatchObject({ startsAt: '2026-12-20T20:00', timezone: 'America/Manaus' });
  });
});
