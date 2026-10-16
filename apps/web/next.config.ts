import { fileURLToPath } from 'node:url';

import { type NextConfig } from 'next';

// Os rewrites de /api/* para a API (BFF) entram na etapa 6.1.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Gera .next/standalone com só os arquivos necessários em runtime (imagem Docker enxuta).
  // No monorepo, o rastreamento precisa partir da raiz para incluir os pacotes do workspace.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default nextConfig;
