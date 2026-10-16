import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';

import { type Params } from 'nestjs-pino';

import { type ApiEnv } from './env';

const REQUEST_ID_HEADER = 'x-request-id';
// Aceita o id de quem chama (proxy, BFF) só se for curto e sem caracteres estranhos.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reaproveita o `x-request-id` recebido ou gera um, e devolve no header da resposta. */
export function requestIdFor(request: IncomingMessage, response: ServerResponse): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  response.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** Logs JSON do nestjs-pino com `request_id` e sem dados sensíveis (CLAUDE.md, regra 11). */
export function loggerParams(env: ApiEnv): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: requestIdFor,
      // Logs feitos durante a requisição levam só o `request_id`, não a requisição inteira.
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'request_id' },
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
      // Health checks de orquestrador chegam a cada poucos segundos: não poluem o log.
      autoLogging: { ignore: (request) => request.url?.startsWith('/health') ?? false },
    },
  };
}
