import { describe, expect, it } from 'vitest';

import { healthLiveResponseSchema } from './health.js';

describe('healthLiveResponseSchema', () => {
  it('aceita a resposta de liveness', () => {
    expect(healthLiveResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejeita status desconhecido', () => {
    expect(healthLiveResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
