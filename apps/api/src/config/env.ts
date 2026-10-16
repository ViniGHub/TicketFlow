import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Variáveis de ambiente da API (ARCHITECTURE.md, seção 11). Validadas no boot. */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl.optional(),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  JWT_SECRET: z.string().min(32, 'use pelo menos 32 caracteres'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  RESERVATION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  APP_URL: z.url(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export class InvalidEnvError extends Error {
  constructor(details: string) {
    super(`Variáveis de ambiente inválidas:\n${details}`);
    this.name = 'InvalidEnvError';
  }
}

export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(z.prettifyError(result.error));
  }
  return result.data;
}
