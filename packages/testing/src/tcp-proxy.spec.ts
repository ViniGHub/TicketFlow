import { createServer, type Server, connect } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startTcpProxy, type TcpProxy } from './tcp-proxy.js';

// Um servidor de eco local faz o papel do serviço: não precisa de Docker.

let echo: Server;
let echoPort: number;
let proxy: TcpProxy;

beforeEach(async () => {
  echo = createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
  const address = echo.address();
  echoPort = address && typeof address === 'object' ? address.port : 0;
  proxy = await startTcpProxy({ host: '127.0.0.1', port: echoPort });
});

afterEach(async () => {
  await proxy.close();
  await new Promise<void>((resolve) => echo.close(() => resolve()));
});

/** Manda uma mensagem pelo proxy e devolve a resposta, ou o erro de conexão. */
function roundTrip(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(message));
    socket.once('data', (data) => {
      resolve(data.toString());
      socket.destroy();
    });
    socket.once('error', reject);
  });
}

describe('proxy TCP', () => {
  it('repassa os dados ao serviço e devolve a resposta', async () => {
    await expect(roundTrip(proxy.port, 'oi')).resolves.toBe('oi');
  });

  it('parado, recusa conexões; religado, volta na mesma porta', async () => {
    const port = proxy.port;

    await proxy.stop();
    await expect(roundTrip(port, 'oi')).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    await proxy.start();
    expect(proxy.port).toBe(port);
    await expect(roundTrip(port, 'de novo')).resolves.toBe('de novo');
  });

  it('parar derruba as conexões abertas', async () => {
    const socket = connect(proxy.port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

    await proxy.stop();

    await expect(closed).resolves.toBeUndefined();
  });

  it('troca o host e a porta de uma URL pelos do proxy', () => {
    expect(proxy.urlFor('redis://localhost:32768')).toBe(`redis://127.0.0.1:${proxy.port}`);
  });
});
