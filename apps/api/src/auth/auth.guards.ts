import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type Role } from '@ticketflow/contracts';
import { type Request } from 'express';

import { type AccessTokenPayload } from './auth.service';
import { ACCESS_COOKIE } from './session';

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
}

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** Exige access token válido no cookie e preenche `request.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Faça login.' });
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      request.user = { id: payload.sub, roles: payload.roles };
      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'ACCESS_TOKEN_INVALID',
        message: 'Sessão expirada ou inválida.',
      });
    }
  }
}

const ROLES_KEY = 'roles';

/** Exige ao menos um dos papéis. Use junto com o JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user && required.some((role) => user.roles.includes(role))) {
      return true;
    }
    throw new ForbiddenException({
      code: 'INSUFFICIENT_ROLE',
      message: 'Você não tem permissão para esta ação.',
    });
  }
}

/** Usuário autenticado pelo JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Faça login.' });
  }
  return user;
});
