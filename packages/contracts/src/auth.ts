import { z } from 'zod';

/** Papéis de um usuário (ARCHITECTURE.md, seção 3). Um usuário pode ter os dois. */
export const ROLES = ['BUYER', 'ORGANIZER'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** E-mail normalizado (sem espaços, em minúsculas) antes da validação. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())
  .meta({ format: 'email', example: 'ana@exemplo.com' });

/** Limite superior evita que uma senha enorme vire custo de CPU no hash. */
const passwordSchema = z.string().min(8).max(128).meta({ example: 'uma-senha-forte' });

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).meta({ example: 'Ana Souza' }),
  /** Quem se cadastra escolhe ser comprador, organizador ou os dois. Padrão: comprador. */
  roles: z
    .array(roleSchema)
    .min(1)
    .max(ROLES.length)
    .refine((roles) => new Set(roles).size === roles.length, 'Papéis repetidos.')
    .default(['BUYER']),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No login não se valida o tamanho mínimo: a senha errada responde 401, não 400.
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Usuário autenticado: resposta de `GET /me`, do cadastro e do login. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  roles: z.array(roleSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
