import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Request } from 'express';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origens aceitas em requisições que alteram estado. */
export function allowedOrigins(env: ApiEnv): Set<string> {
  const origins = new Set([new URL(env.APP_URL).origin]);
  if (env.NODE_ENV !== 'production') {
    // Swagger UI servido pela própria API em desenvolvimento.
    origins.add(`http://localhost:${env.API_PORT}`);
    origins.add(`http://127.0.0.1:${env.API_PORT}`);
  }
  return origins;
}

/**
 * Proteção CSRF complementar ao SameSite=Lax (ARCHITECTURE.md, seção 10): requisição que
 * altera estado com `Origin` de fora da lista é recusada. Sem `Origin` passa: navegadores
 * sempre o enviam em requisições cross-site que alteram estado, e clientes que não são
 * navegador (curl, o Stripe) não carregam cookies da vítima. `Origin: null` é recusado.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.allowed = allowedOrigins(env);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const origin = request.headers.origin;
    if (origin === undefined || this.allowed.has(origin)) {
      return true;
    }
    throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origem não permitida.' });
  }
}
