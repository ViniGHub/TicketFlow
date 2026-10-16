import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type LoginRequest,
  loginRequestSchema,
  type MeResponse,
  meResponseSchema,
  type RegisterRequest,
  registerRequestSchema,
} from '@ticketflow/contracts';
import { type Request, type Response } from 'express';

import { openApiSchema, ZodValidationPipe } from '../common/validation';
import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

import { clearSessionCookies, setSessionCookies, type SessionCookieOptions } from './auth.cookies';
import { type AuthenticatedUser, CurrentUser, JwtAuthGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE } from './session';

const ONE_MINUTE_MS = 60_000;
const meSchema = openApiSchema(meResponseSchema, 'output');

function refreshTokenFrom(request: Request): string | undefined {
  const token: unknown = request.cookies?.[REFRESH_COOKIE];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 20, ttl: ONE_MINUTE_MS } })
export class AuthController {
  private readonly cookies: SessionCookieOptions;

  constructor(
    private readonly auth: AuthService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.cookies = { refreshPath: env.REFRESH_COOKIE_PATH };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ schema: openApiSchema(registerRequestSchema) })
  @ApiCreatedResponse({
    description: 'Usuário criado e logado (cookies definidos).',
    schema: meSchema,
  })
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    const session = await this.auth.register(body);
    setSessionCookies(response, session, this.cookies);
    return session.user;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Mais restrito que o resto de /auth: é o alvo de força bruta.
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @ApiBody({ schema: openApiSchema(loginRequestSchema) })
  @ApiOkResponse({ description: 'Logado (cookies definidos).', schema: meSchema })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    const session = await this.auth.login(body);
    setSessionCookies(response, session, this.cookies);
    return session.user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Tokens rotacionados (cookies novos).', schema: meSchema })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    const session = await this.auth.refresh(refreshTokenFrom(request));
    setSessionCookies(response, session, this.cookies);
    return session.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Sessão encerrada e cookies removidos.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(refreshTokenFrom(request));
    clearSessionCookies(response, this.cookies);
  }
}

@ApiTags('auth')
@ApiCookieAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOkResponse({ description: 'Usuário autenticado.', schema: meSchema })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const me = await this.auth.me(user.id);
    if (!me) {
      // Token válido de um usuário que não existe mais.
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Faça login.' });
    }
    return me;
  }
}
