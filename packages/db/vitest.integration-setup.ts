import { fileURLToPath } from 'node:url';

import { createIntegrationSetup } from '@ticketflow/testing';

export default createIntegrationSetup({
  postgres: { prismaPackageDir: fileURLToPath(new URL('.', import.meta.url)) },
});
