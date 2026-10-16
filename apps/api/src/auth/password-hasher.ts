import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Injectable, type OnModuleInit } from '@nestjs/common';

const argon2Async = promisify(argon2);

// Parâmetros mínimos recomendados pela OWASP para argon2id (19 MiB, 2 passadas, 1 thread).
// Os mesmos do seed (packages/db/src/seed/dev-password.ts).
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

// Teto para parâmetros lidos de um hash gravado: evita que um hash adulterado no banco
// transforme cada login num consumo enorme de memória.
const MAX_MEMORY_KIB = 262_144;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 8;

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const base64NoPadding = (buffer: Buffer): string => buffer.toString('base64').replace(/=+$/, '');

interface Argon2Options {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tagLength: number;
}

function derive(password: string, options: Argon2Options): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: password,
    nonce: options.salt,
    memory: options.memory,
    passes: options.passes,
    parallelism: options.parallelism,
    tagLength: options.tagLength,
  });
}

/**
 * Hash de senha com argon2id do `node:crypto` (Node 24.7+), no formato PHC
 * (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), lido por qualquer biblioteca de argon2.
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Hash de uma senha qualquer, para o login de e-mail inexistente gastar o mesmo tempo. */
  private dummyHash?: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(16).toString('hex'));
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const hash = await derive(password, {
      memory: MEMORY_KIB,
      passes: PASSES,
      parallelism: PARALLELISM,
      salt,
      tagLength: TAG_LENGTH,
    });
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${base64NoPadding(salt)}$${base64NoPadding(hash)}`;
  }

  /** Compara em tempo constante. Hash em formato desconhecido ou fora dos limites: `false`. */
  async verify(password: string, phc: string): Promise<boolean> {
    const match = PHC_PATTERN.exec(phc);
    if (!match) {
      return false;
    }
    const [, memory, passes, parallelism, salt, hash] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const options = {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      salt: Buffer.from(salt, 'base64'),
    };
    if (
      options.memory > MAX_MEMORY_KIB ||
      options.passes > MAX_PASSES ||
      options.parallelism > MAX_PARALLELISM
    ) {
      return false;
    }
    const expected = Buffer.from(hash, 'base64');
    const actual = await derive(password, { ...options, tagLength: expected.length });
    return timingSafeEqual(actual, expected);
  }

  /** Gasta o tempo de uma verificação real e devolve `false`. */
  async verifyAgainstDummy(password: string): Promise<false> {
    await this.verify(password, this.dummyHash ?? (await this.hash('dummy')));
    return false;
  }
}
