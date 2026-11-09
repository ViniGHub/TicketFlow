import { fileURLToPath } from 'node:url';

import { createIntegrationSetup } from '@ticketflow/testing';

// Postgres com as migrations de packages/db (outbox), e Redis (filas do BullMQ).
export default createIntegrationSetup({
  postgres: { prismaPackageDir: fileURLToPath(new URL('../../packages/db', import.meta.url)) },
  redis: true,
});
