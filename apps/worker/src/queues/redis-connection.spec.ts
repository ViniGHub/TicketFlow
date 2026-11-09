import { describe, expect, it } from 'vitest';

import { redisConnectionOptions } from './redis-connection';

describe('conexão com o Redis a partir do REDIS_URL', () => {
  it('lê host e porta, com db 0 por padrão', () => {
    expect(redisConnectionOptions('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 0,
    });
  });

  it('lê usuário, senha (decodificados) e db', () => {
    expect(redisConnectionOptions('redis://ticketflow:s%40nha@redis.interno:6380/2')).toEqual({
      host: 'redis.interno',
      port: 6380,
      db: 2,
      username: 'ticketflow',
      password: 's@nha',
    });
  });

  it('rediss:// liga o TLS, e a porta padrão é a 6379', () => {
    expect(redisConnectionOptions('rediss://:senha@redis.gerenciado')).toEqual({
      host: 'redis.gerenciado',
      port: 6379,
      db: 0,
      password: 'senha',
      tls: {},
    });
  });
});
