import { Reflector } from '@nestjs/core';
import { type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';

import { UserThrottlerGuard } from './user-throttler.guard';

// O limite em si (429 na 21ª requisição) é coberto em orders.int-spec.ts, com Redis real.
class InspectableGuard extends UserThrottlerGuard {
  tracker(request: Record<string, unknown>): Promise<string> {
    return this.getTracker(request);
  }
}

const options: ThrottlerModuleOptions = { throttlers: [] };
const guard = new InspectableGuard(options, {} as ThrottlerStorage, new Reflector());

describe('UserThrottlerGuard', () => {
  it('conta por usuário quando há sessão', async () => {
    await expect(
      guard.tracker({ user: { id: 'u-1', roles: ['BUYER'] }, ip: '10.0.0.1' }),
    ).resolves.toBe('user:u-1');
  });

  it('dois usuários no mesmo IP têm limites separados', async () => {
    const [a, b] = await Promise.all([
      guard.tracker({ user: { id: 'u-1', roles: [] }, ip: '10.0.0.1' }),
      guard.tracker({ user: { id: 'u-2', roles: [] }, ip: '10.0.0.1' }),
    ]);
    expect(a).not.toBe(b);
  });

  it('sem sessão, cai para o IP', async () => {
    await expect(guard.tracker({ ip: '10.0.0.1' })).resolves.toBe('ip:10.0.0.1');
  });
});
