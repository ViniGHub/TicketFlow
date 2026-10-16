import { defineVitestConfig } from '@ticketflow/config/vitest';

export default defineVitestConfig(
  // Os testes de integração compartilham um único Postgres e limpam as tabelas entre os
  // testes: arquivos em paralelo apagariam os dados uns dos outros.
  { test: { fileParallelism: false } },
  { integrationGlobalSetup: ['./vitest.integration-setup.ts'] },
);
