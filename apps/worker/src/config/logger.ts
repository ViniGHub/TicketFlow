import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { type WorkerEnv } from './env';

const levels: Record<WorkerEnv['LOG_LEVEL'], LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Logger JSON nativo do Nest. Será substituído por nestjs-pino junto com a api. */
export function createLogger(level: WorkerEnv['LOG_LEVEL']): ConsoleLogger {
  return new ConsoleLogger({ json: true, logLevels: levels[level] });
}
