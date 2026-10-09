import type { TestProject } from 'vitest/node';

import { applyPrismaMigrations } from './migrations.js';
import { startPostgres, type StartedPostgres } from './postgres.js';
import { startRedis, type StartedRedis } from './redis.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL do Postgres do container de teste (via `inject('databaseUrl')`). */
    databaseUrl: string;
    /** URL do Redis do container de teste (via `inject('redisUrl')`). */
    redisUrl: string;
  }
}

export interface IntegrationSetupOptions {
  /** Sobe um Postgres. `prismaPackageDir` aplica as migrations do pacote db. */
  postgres?: { prismaPackageDir?: string };
  /** Sobe um Redis. */
  redis?: boolean;
}

/**
 * Cria o globalSetup do projeto de integração do Vitest: sobe os containers uma vez por
 * execução, entrega as URLs aos testes via `inject(...)` e derruba tudo no final.
 *
 * ```ts
 * // vitest.integration-setup.ts
 * export default createIntegrationSetup({ postgres: { prismaPackageDir: '...' }, redis: true });
 * ```
 */
export function createIntegrationSetup(options: IntegrationSetupOptions) {
  return async function setup(project: TestProject): Promise<() => Promise<void>> {
    // Se um container falhar ao subir, o Ryuk (reaper do Testcontainers) remove os demais
    // quando o processo termina.
    const [postgres, redis]: [StartedPostgres | undefined, StartedRedis | undefined] =
      await Promise.all([
        options.postgres ? startPostgres() : undefined,
        options.redis ? startRedis() : undefined,
      ]);

    if (postgres) {
      if (options.postgres?.prismaPackageDir) {
        await applyPrismaMigrations(postgres.url, options.postgres.prismaPackageDir);
      }
      project.provide('databaseUrl', postgres.url);
    }
    if (redis) {
      project.provide('redisUrl', redis.url);
    }

    return async () => {
      await Promise.all([postgres?.stop(), redis?.stop()]);
    };
  };
}
