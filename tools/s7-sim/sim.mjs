// S7comm (ISO-on-TCP) simulator for the tests of feature 016 (contracts/s7-driver.md §6). Node >= 22,
// no package. Only for tests: it holds PLC-like memory, answers like an S7 CPU with PUT/GET and
// breaks on command.
//
//   node tools/s7-sim/sim.mjs --tcp 102 --control 1503 --map tools/s7-sim/maps/all-types.json
//        [--log requests.jsonl] [--host 0.0.0.0] [--control-host 127.0.0.1]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { splitTpkt } from './codec.mjs';
import { createControl } from './control.mjs';
import { loadMap } from './map.mjs';
import { SimServer } from './server.mjs';

const listen = (server, port, host) =>
  new Promise((resolve, reject) => {
    const onError = (e) => reject(e);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });

/**
 * Starts the simulator. `map`: the map object or a path to a JSON file. Port 0 takes a free port.
 * `now`: the clock (animated values, log time). Returns { tcpPort, controlPort, server, close() }.
 */
export async function startSim({
  map,
  tcpPort = 102,
  controlPort = 1503,
  host = '0.0.0.0',
  controlHost = '127.0.0.1',
  logFile = null,
  now = Date.now,
}) {
  const json = typeof map === 'string' ? JSON.parse(readFileSync(map, 'utf8')) : map;
  if (logFile) writeFileSync(logFile, '');
  const sockets = new Set();
  let tcp = null;
  let port = tcpPort;
  const sim = new SimServer({
    memory: loadMap(json, now),
    now,
    onLog: logFile ? (e) => appendFileSync(logFile, JSON.stringify(e) + '\n') : null,
    onRefuseChange: (on) => {
      if (on) stopTcp();
      else startTcp().catch(() => {});
    },
  });

  function stopTcp() {
    if (!tcp) return;
    const t = tcp;
    tcp = null;
    t.close();
    for (const s of sockets) s.destroy();
  }

  async function startTcp() {
    if (tcp) return;
    const t = net.createServer((sock) => {
      sock.setNoDelay(true);
      sockets.add(sock);
      const conn = sim.connOpened();
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const r = splitTpkt(buf);
        buf = r.rest;
        for (const frame of r.frames) {
          const plan = conn.handleFrame(frame);
          if (plan.action === 'close') {
            sock.destroy();
            return;
          }
          if (plan.action !== 'respond') continue;
          const send = () => {
            if (sock.destroyed) return;
            for (const b of plan.buffers) sock.write(b);
            if (plan.closeAfter) sock.end();
          };
          if (plan.delayMs > 0) setTimeout(send, plan.delayMs);
          else send();
        }
        if (r.bad) {
          sim.stats.errors++;
          sock.destroy();
        }
      });
      sock.on('error', () => {});
      sock.on('close', () => {
        sockets.delete(sock);
        sim.connClosed();
      });
    });
    tcp = t;
    port = await listen(t, port, host);
  }

  await startTcp();
  const control = createControl(sim);
  const ctlPort = await listen(control, controlPort, controlHost);
  return {
    tcpPort: port,
    controlPort: ctlPort,
    server: sim,
    async close() {
      stopTcp();
      await new Promise((r) => control.close(r));
      control.closeAllConnections?.();
    },
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined) throw new Error(`${a} needs a value`);
    out[key] = val;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const a = parseArgs(process.argv.slice(2));
    if (!a.map) throw new Error('--map <file> is required');
    const s = await startSim({
      map: a.map,
      tcpPort: Number(a.tcp ?? 102),
      controlPort: Number(a.control ?? 1503),
      host: a.host ?? '0.0.0.0',
      controlHost: a['control-host'] ?? '127.0.0.1',
      logFile: a.log ?? null,
    });
    console.log(`s7-sim: tcp ${s.tcpPort}, control ${s.controlPort}`);
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    console.error(`s7-sim: ${e.message}`);
    process.exit(2);
  }
}
