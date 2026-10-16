import {
  type ArgumentsHost,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  ServiceUnavailableException,
  UseFilters,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { type HealthLiveResponse } from '@ticketflow/contracts';
import { type Response } from 'express';

import { DatabaseHealthIndicator, RedisHealthIndicator } from './health.indicators';

/**
 * O terminus responde 503 lançando ServiceUnavailableException com o resultado das
 * verificações. Este filtro devolve esse resultado como está, em vez do formato de erro
 * padrão da API, para quem monitora ver qual dependência caiu.
 */
@Catch(ServiceUnavailableException)
class HealthCheckFailureFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(503).json(exception.getResponse());
  }
}

@ApiTags('health')
@Controller('health')
@UseFilters(HealthCheckFailureFilter)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: o processo está de pé. Não depende de nada externo. */
  @Get('live')
  @ApiOkResponse({ description: 'O processo está de pé.' })
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }

  /** Readiness: o processo consegue atender (banco e Redis respondem). */
  @Get('ready')
  @HealthCheck()
  @ApiOkResponse({ description: 'Banco e Redis respondem.' })
  @ApiServiceUnavailableResponse({ description: 'Banco ou Redis fora; o corpo diz qual.' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.isHealthy(), () => this.redis.isHealthy()]);
  }
}
