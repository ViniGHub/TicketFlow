import { type NextConfig } from 'next';

// Os rewrites de /api/* para a API (BFF) entram na etapa 6.1.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
