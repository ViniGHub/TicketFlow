import { z } from 'zod';

/** Formato de todas as respostas de erro da API. */
export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  /** Código estável para o front-end tratar o erro (ex.: `INVALID_CREDENTIALS`). */
  code: z.string(),
  message: z.string(),
  /** Mesmo valor do header `x-request-id`, para cruzar com os logs. */
  requestId: z.string().optional(),
  /** Presente em erros de validação (400). */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
