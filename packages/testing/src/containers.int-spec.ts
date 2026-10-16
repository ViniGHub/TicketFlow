import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres, truncateAllTables, type StartedPostgres } from './postgres.js';
import { flushRedis, startRedis, type StartedRedis } from './redis.js';

describe('containers de teste', () => {
  let postgres: StartedPostgres;
  let redis: StartedRedis;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([startPostgres(), startRedis()]);
  });

  afterAll(async () => {
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  it('Postgres responde e truncateAllTables esvazia as tabelas', async () => {
    const client = new pg.Client({ connectionString: postgres.url });
    await client.connect();
    try {
      await client.query('CREATE TABLE amostra (id serial PRIMARY KEY, nome text)');
      await client.query(`INSERT INTO amostra (nome) VALUES ('a'), ('b')`);

      await truncateAllTables(postgres.url);

      const { rows } = await client.query<{ total: string }>(
        'SELECT count(*) AS total FROM amostra',
      );
      expect(rows[0]?.total).toBe('0');
    } finally {
      await client.end();
    }
  });

  it('Redis responde e flushRedis apaga as chaves', async () => {
    const client = new Redis(redis.url);
    try {
      await client.set('chave', 'valor');

      await flushRedis(redis.url);

      expect(await client.dbsize()).toBe(0);
    } finally {
      client.disconnect();
    }
  });
});
