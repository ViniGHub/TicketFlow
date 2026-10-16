import { argon2Sync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEV_PASSWORD, hashPasswordForSeed } from './dev-password.js';

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

describe('hashPasswordForSeed', () => {
  it('gera um hash argon2id no formato PHC que confere com a senha', () => {
    const phc = hashPasswordForSeed(DEV_PASSWORD);
    const match = PHC.exec(phc);

    expect(match).not.toBeNull();
    const [, memory, passes, parallelism, salt, hash] = match as RegExpExecArray;
    const recomputed = argon2Sync('argon2id', {
      message: DEV_PASSWORD,
      nonce: Buffer.from(salt as string, 'base64'),
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      tagLength: Buffer.from(hash as string, 'base64').length,
    });
    expect(recomputed.toString('base64').replace(/=+$/, '')).toBe(hash);
  });

  it('usa um salt aleatório a cada chamada', () => {
    expect(hashPasswordForSeed(DEV_PASSWORD)).not.toBe(hashPasswordForSeed(DEV_PASSWORD));
  });
});
