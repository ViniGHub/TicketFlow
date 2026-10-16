// Healthcheck do container do worker: `node dist/healthcheck.js`.
// Lê só a variável do heartbeat, para não depender do restante da configuração.
import { defaultHeartbeatFile, isHeartbeatFresh } from './heartbeat/heartbeat';

const file = process.env.WORKER_HEARTBEAT_FILE || defaultHeartbeatFile();

void isHeartbeatFresh(file).then((fresh) => {
  process.exit(fresh ? 0 : 1);
});
