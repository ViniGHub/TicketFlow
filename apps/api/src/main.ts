import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApp } from './app.factory';
import { parseApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Em dev, carrega o .env da raiz do monorepo. Em produção as variáveis vêm do ambiente.
  const rootEnv = resolve(__dirname, '../../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }

  const env = parseApiEnv(process.env);
  const app = await createApp(env);
  await app.listen(env.API_PORT);
}

void bootstrap();
