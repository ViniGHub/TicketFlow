import { describe, expect, it } from 'vitest';

import { createPrismaClient } from './index.js';

describe('createPrismaClient', () => {
  it('cria o client sem abrir conexão com o banco', async () => {
    const client = createPrismaClient('postgresql://user:pass@localhost:5432/ticketflow');

    expect(typeof client.$connect).toBe('function');
    await client.$disconnect();
  });
});
