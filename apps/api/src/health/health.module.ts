import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { DatabaseHealthIndicator, RedisHealthIndicator } from './health.indicators';

@Module({
  // O motivo de cada falha já é logado pelos indicadores (health.indicators.ts).
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
