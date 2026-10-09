import { z } from 'zod';

/** Variável opcional: `CHAVE=` vazio no .env conta como ausente. */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** Variáveis de ambiente do worker (ARCHITECTURE.md, seção 11). Validadas no boot. */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  APP_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  EMAIL_FROM: z.email(),
  RESEND_API_KEY: optionalString,
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class InvalidEnvError extends Error {
  constructor(details: string) {
    super(`Variáveis de ambiente inválidas:\n${details}`);
    this.name = 'InvalidEnvError';
  }
}

export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(z.prettifyError(result.error));
  }
  return result.data;
}
