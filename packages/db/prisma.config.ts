import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env sozinho. Em dev usamos o .env da raiz do monorepo;
// em CI e produção as variáveis já vêm do ambiente.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations usam a conexão direta (sem pooler); o client em runtime usa DATABASE_URL.
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
});
