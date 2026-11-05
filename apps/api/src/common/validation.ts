import { type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { type ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

/** Schema OpenAPI aceito pelos decorators do Swagger (o pacote não exporta o tipo direto). */
type OpenApiSchema = NonNullable<
  Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema']
>;

// Mensagens de validação do zod em português (afeta todas as respostas 400 da API).
z.config(z.locales.pt());

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Corpo ou parâmetro da requisição inválido. O filtro de erros responde 400 com os detalhes. */
export class RequestValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super('Requisição inválida.');
    this.name = 'RequestValidationError';
  }
}

/** Valida e transforma a entrada com um schema zod de packages/contracts. */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Num parâmetro de rota (`@Param('id')`), o caminho começa pelo nome do parâmetro.
      const prefix = metadata?.type === 'param' && metadata.data ? [metadata.data] : [];
      throw new RequestValidationError(
        result.error.issues.map((issue) => ({
          path: [...prefix, ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

/** Valida um id da rota: um UUID malformado responde 400 em vez de virar erro no Postgres. */
export const uuidParamPipe = new ZodValidationPipe(z.uuid());

/**
 * Converte um schema zod em schema OpenAPI 3.0 para o Swagger. `input` descreve o que o
 * cliente envia (corpo); `output`, o que a API devolve (resposta).
 */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): OpenApiSchema {
  return z.toJSONSchema(schema, { io, target: 'openapi-3.0' }) as OpenApiSchema;
}
