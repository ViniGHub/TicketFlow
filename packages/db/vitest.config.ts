import { defineVitestConfig } from '@ticketflow/config/vitest';

export default defineVitestConfig(
  {},
  { integrationGlobalSetup: ['./vitest.integration-setup.ts'] },
);
