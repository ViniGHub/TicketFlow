import { Controller, Get } from '@nestjs/common';
import { type HealthLiveResponse } from '@ticketflow/contracts';

@Controller('health')
export class HealthController {
  /** Liveness: o processo está de pé. A readiness (banco e Redis) entra na etapa 1.4. */
  @Get('live')
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }
}
