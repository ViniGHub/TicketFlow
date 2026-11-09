import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { parseWorkerEnv } from './config/env';
import { createLogger } from './config/logger';
import { HEARTBEAT_INTERVAL_MS } from './heartbeat/heartbeat';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // Em dev, carrega o .env da raiz do monorepo. Em produção as variáveis vêm do ambiente.
  const rootEnv = resolve(__dirname, '../../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }

  const env = parseWorkerEnv(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(
    WorkerModule.register({
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      email: {
        from: env.EMAIL_FROM,
        smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT },
        ...(env.RESEND_API_KEY && { resendApiKey: env.RESEND_API_KEY }),
      },
      heartbeat: { file: env.WORKER_HEARTBEAT_FILE, intervalMs: HEARTBEAT_INTERVAL_MS },
    }),
    { logger },
  );

  // SIGTERM/SIGINT disparam o shutdown do Nest: o relay termina o lote em andamento, depois
  // fecham as filas e o banco.
  app.enableShutdownHooks();
  logger.log('Worker iniciado', 'Bootstrap');
}

void bootstrap();
