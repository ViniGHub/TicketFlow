import { afterAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient } from './index.js';

describe('createPrismaClient (Postgres real)', () => {
  const client = createPrismaClient(inject('databaseUrl'));

  afterAll(async () => {
    await client.$disconnect();
  });

  it('conecta pelo driver pg e executa uma consulta', async () => {
    const rows = await client.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;

    expect(rows).toEqual([{ ok: 1 }]);
  });
});
