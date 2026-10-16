import { defineNestVitestConfig } from '@ticketflow/config/vitest';

export default defineNestVitestConfig(
  // Os testes de integração compartilham um Postgres e um Redis e limpam o estado entre
  // testes: arquivos em paralelo apagariam os dados uns dos outros.
  { test: { fileParallelism: false } },
  { integrationGlobalSetup: ['./vitest.integration-setup.mts'] },
);
