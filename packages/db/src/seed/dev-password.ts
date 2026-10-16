import { argon2Sync, randomBytes } from 'node:crypto';

/** Senha dos usuários do seed. Só existe em desenvolvimento (README, "Usuários do seed"). */
export const DEV_PASSWORD = 'ticketflow-dev';

// Parâmetros mínimos recomendados pela OWASP para argon2id (19 MiB, 2 passadas, 1 thread).
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;

const base64NoPadding = (buffer: Buffer): string => buffer.toString('base64').replace(/=+$/, '');

/**
 * Gera o hash argon2id no formato PHC (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), o
 * mesmo que as bibliotecas de argon2 leem. A autenticação (etapa 1.4) verifica esse formato.
 */
export function hashPasswordForSeed(password: string): string {
  const salt = randomBytes(16);
  const hash = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: PARALLELISM,
    tagLength: TAG_LENGTH,
  });
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${base64NoPadding(salt)}$${base64NoPadding(hash)}`;
}
