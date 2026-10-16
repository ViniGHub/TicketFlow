import { fileURLToPath } from 'node:url';

import { createIntegrationSetup } from '@ticketflow/testing';

// Postgres com as migrations de packages/db, e Redis (rate limit).
export default createIntegrationSetup({
  postgres: { prismaPackageDir: fileURLToPath(new URL('../../packages/db', import.meta.url)) },
  redis: true,
});
