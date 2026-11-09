import { createServer, type Server, type Socket, connect } from 'node:net';

// Proxy TCP para simular a queda de um serviço (ex.: Redis) no meio de um teste, sem reiniciar
// o container: reiniciar pode trocar a porta, e o cliente perderia o endereço.

export interface TcpProxyTarget {
  host: string;
  port: number;
}

export interface TcpProxy {
  /** Porta local do proxy (127.0.0.1). Continua a mesma depois de `stop()` e `start()`. */
  readonly port: number;
  /** Endereço com a porta do proxy no lugar da do serviço, ex. `redis://127.0.0.1:<port>`. */
  urlFor(serviceUrl: string): string;
  /** Derruba as conexões abertas e para de aceitar novas: para o cliente, o serviço caiu. */
  stop(): Promise<void>;
  /** Volta a aceitar conexões na mesma porta. */
  start(): Promise<void>;
  /** Encerra o proxy de vez. */
  close(): Promise<void>;
}

/** Sobe um proxy em 127.0.0.1, numa porta livre, repassando tudo para `target`. */
export async function startTcpProxy(target: TcpProxyTarget): Promise<TcpProxy> {
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const next = createServer((client) => {
        const upstream = connect(target.port, target.host);
        track(client);
        track(upstream);
        client.pipe(upstream).pipe(client);
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
      });
      next.once('error', reject);
      next.listen(port, '127.0.0.1', () => {
        const address = next.address();
        if (address && typeof address === 'object') {
          port = address.port;
        }
        server = next;
        resolve();
      });
    });

  const stop = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server = undefined;
    });

  await listen();

  return {
    get port() {
      return port;
    },
    urlFor(serviceUrl: string) {
      const url = new URL(serviceUrl);
      url.hostname = '127.0.0.1';
      url.port = String(port);
      return url.toString();
    },
    stop,
    start: () => (server ? Promise.resolve() : listen()),
    close: stop,
  };
}
