import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

/** Mesma imagem do docker-compose.yml, para os testes rodarem contra a versão de produção. */
export const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface StartedPostgres {
  url: string;
  stop(): Promise<void>;
}

export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('ticketflow')
    .withUsername('ticketflow')
    .withPassword('ticketflow')
    .start();

  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Esvazia todas as tabelas do schema `public` (menos o histórico de migrations do Prisma),
 * reiniciando sequências. Use entre testes para isolar o estado.
 */
export async function truncateAllTables(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) {
      return;
    }
    const tables = rows.map((row) => quoteIdentifier(row.tablename)).join(', ');
    await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}
