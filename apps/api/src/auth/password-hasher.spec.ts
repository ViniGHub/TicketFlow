import { DEV_PASSWORD, hashPasswordForSeed } from '@ticketflow/db/seed';
import { beforeAll, describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  beforeAll(async () => {
    await hasher.onModuleInit();
  });

  it('gera argon2id no formato PHC e confere a senha certa', async () => {
    const hash = await hasher.hash('uma-senha-forte');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify('uma-senha-forte', hash)).resolves.toBe(true);
  });

  it('recusa a senha errada', async () => {
    const hash = await hasher.hash('uma-senha-forte');

    await expect(hasher.verify('outra-senha', hash)).resolves.toBe(false);
  });

  it('usa salt aleatório', async () => {
    expect(await hasher.hash('igual')).not.toBe(await hasher.hash('igual'));
  });

  it('confere os hashes gerados pelo seed (packages/db)', async () => {
    await expect(hasher.verify(DEV_PASSWORD, hashPasswordForSeed(DEV_PASSWORD))).resolves.toBe(
      true,
    );
  });

  it.each([
    ['formato desconhecido', '$2b$10$abcdefghijklmnopqrstuv'],
    ['outro algoritmo', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaA'],
    ['memória acima do teto', '$argon2id$v=19$m=999999999,t=2,p=1$c2FsdHNhbHQ$aGFzaA'],
  ])('recusa hash com %s sem calcular nada', async (_case, phc) => {
    await expect(hasher.verify('qualquer', phc)).resolves.toBe(false);
  });

  it('verificação contra o hash fictício sempre falha', async () => {
    await expect(hasher.verifyAgainstDummy('qualquer')).resolves.toBe(false);
  });
});
