import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { parseApiEnv } from './config/env';
import { createLogger } from './config/logger';

async function bootstrap(): Promise<void> {
  // Em dev, carrega o .env da raiz do monorepo. Em produção as variáveis vêm do ambiente.
  const rootEnv = resolve(__dirname, '../../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }

  const env = parseApiEnv(process.env);
  const app = await NestFactory.create(AppModule, { logger: createLogger(env.LOG_LEVEL) });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}

void bootstrap();
