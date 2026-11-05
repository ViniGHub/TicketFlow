import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { type AuthenticatedUser } from '../auth/auth.guards';

/**
 * Rate limit por usuário nas rotas autenticadas (ARCHITECTURE.md, seção 10). Por IP,
 * compradores atrás do mesmo Wi-Fi (o do local do evento, por exemplo) dividiriam o limite.
 * Use depois do JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard, UserThrottlerGuard)`.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const user = request['user'] as AuthenticatedUser | undefined;
    return Promise.resolve(user ? `user:${user.id}` : `ip:${String(request['ip'])}`);
  }
}
