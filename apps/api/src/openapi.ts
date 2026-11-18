// Gera o openapi.json da API sem subir o servidor (ROADMAP, etapa 6.1; ADR 0016): o front gera
// os tipos dele a partir deste arquivo. `pnpm api:types`, na raiz, roda isto e o openapi-typescript.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { createOpenApiDocument } from './app.factory';
import { parseApiEnv } from './config/env';

/** Saída padrão: apps/api/openapi.json. */
const output = resolve(process.argv[2] ?? resolve(__dirname, '../openapi.json'));

async function main(): Promise<void> {
  // Só monta os módulos: o Prisma conecta na primeira consulta, e o Redis tenta em segundo
  // plano. Nenhum valor aqui é segredo, e nenhum é usado.
  const env = parseApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgresql://localhost:5432/openapi',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'openapi-sem-segredo-de-verdade-aqui',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    APP_URL: 'http://localhost:3001',
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(env),
    new ExpressAdapter(),
    { logger: false },
  );
  const document = createOpenApiDocument(app);
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
