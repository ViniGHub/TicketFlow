// Ponto de entrada do seed: `pnpm --filter @ticketflow/db db:seed` (ou `prisma db seed`).
// Roda o JavaScript compilado em dist/, porque o client gerado importa com extensão .js.
import { existsSync } from 'node:fs';

import { createPrismaClient } from '../index.js';

import { seed } from './seed.js';

// Mesmo comportamento do prisma.config.ts: em dev usa o .env da raiz do monorepo.
const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL não definida.');
}

const prisma = createPrismaClient(databaseUrl);
try {
  const result = await seed(prisma);
  console.log(
    `Seed concluído: ${result.users} usuários, ${result.events} eventos, ${result.ticketTypes} lotes.`,
  );
} finally {
  await prisma.$disconnect();
}
