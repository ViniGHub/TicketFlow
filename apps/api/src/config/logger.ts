import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { type ApiEnv } from './env';

const levels: Record<ApiEnv['LOG_LEVEL'], LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Logger JSON nativo do Nest. Será substituído por nestjs-pino na etapa 1.4. */
export function createLogger(level: ApiEnv['LOG_LEVEL']): ConsoleLogger {
  return new ConsoleLogger({ json: true, logLevels: levels[level] });
}
