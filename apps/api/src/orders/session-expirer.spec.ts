import { describe, expect, it } from 'vitest';

import { NullSessionExpirer } from './session-expirer';

describe('NullSessionExpirer', () => {
  it('trata a sessão como expirada: até a etapa 4.1 não existe sessão para expirar', async () => {
    await expect(new NullSessionExpirer().expireCheckoutSession()).resolves.toBe('expired');
  });
});
