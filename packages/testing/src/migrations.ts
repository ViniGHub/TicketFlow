import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Aplica as migrations do Prisma (`prisma migrate deploy`) no banco informado.
 * `prismaPackageDir` é a pasta do pacote que contém `prisma.config.ts` (packages/db).
 * Sem a pasta `prisma/migrations` não há o que aplicar e nada é executado.
 */
export async function applyPrismaMigrations(
  databaseUrl: string,
  prismaPackageDir: string,
): Promise<void> {
  if (!existsSync(join(prismaPackageDir, 'prisma', 'migrations'))) {
    return;
  }

  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: prismaPackageDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    // No Windows, `pnpm` é um .cmd e só roda via shell. Os argumentos são fixos.
    shell: process.platform === 'win32',
  });
}
