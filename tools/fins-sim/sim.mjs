// Omron FINS simulator for the tests of feature 018 (FINS/UDP and FINS/TCP on the same port number).
// Node >= 22, no package. Only for tests: it holds PLC-like memory, answers like a CS/CJ CPU and breaks
// on command (control.mjs).
//
//   node tools/fins-sim/sim.mjs --port 9600 --control 9601 --map tools/fins-sim/maps/all-types.json
//        [--log requests.jsonl] [--host 0.0.0.0] [--control-host 127.0.0.1]
import dgram from 'node:dgram';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { splitTcp, tcpMessage, TCP_FRAME, TCP_NODE_REQUEST, TCP_NODE_RESPONSE } from './codec.mjs';
import { createControl } from './control.mjs';
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
 * Starts the simulator. `map`: the map object or a path to a JSON file. Port 0 takes a free port (the
 * UDP socket then takes the port the TCP server got). Returns { port, controlPort, server, close() }.
 */
export async function startSim({
  map,
  port = 9600,
  controlPort = 9601,
  host = '0.0.0.0',
  controlHost = '127.0.0.1',
  logFile = null,
  now = Date.now,
}) {
  const json = typeof map === 'string' ? JSON.parse(readFileSync(map, 'utf8')) : map;
  if (logFile) writeFileSync(logFile, '');
  const sim = new SimServer({
    memory: json,
    now,
    onLog: logFile ? (e) => appendFileSync(logFile, JSON.stringify(e) + '\n') : null,
  });
  const sockets = new Set();

  const tcp = net.createServer((sock) => {
    sock.setNoDelay(true);
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    let handshaken = false;
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const r = splitTcp(buf);
      buf = Buffer.from(r.rest);
      if (r.lost) {
        sock.destroy();
        return;
      }
      for (const m of r.messages) {
        if (m.command === TCP_NODE_REQUEST && m.body.length === 4) {
          const h = sim.handshake(m.body.readUInt32BE(0));
          if (h.error) {
            sock.end(tcpMessage(TCP_NODE_RESPONSE, h.error));
            return;
          }
          const body = Buffer.alloc(8);
          body.writeUInt32BE(h.client, 0);
          body.writeUInt32BE(h.server, 4);
          sock.write(tcpMessage(TCP_NODE_RESPONSE, 0, body));
          handshaken = true;
          continue;
        }
        if (m.command !== TCP_FRAME || !handshaken) {
          sock.write(tcpMessage(m.command, 0x03)); // command not supported
          continue;
        }
        const plan = sim.handleFrame(m.body, 'tcp');
        if (plan.action === 'close') {
          sock.destroy();
          return;
        }
        if (plan.action === 'garbage') {
          sock.write(Buffer.from('GARBAGE!'));
          continue;
        }
        if (plan.action !== 'respond') continue;
        const out = () => {
          if (!sock.destroyed)
            for (const b of plan.buffers) sock.write(tcpMessage(TCP_FRAME, 0, b));
        };
        if (plan.delayMs > 0) setTimeout(out, plan.delayMs);
        else out();
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
  });
  const tcpPort = await listen(tcp, port, host);

  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, rinfo) => {
    const plan = sim.handleFrame(msg, 'udp');
    if (plan.action !== 'respond' && plan.action !== 'garbage') return;
    const out = () => {
      for (const b of plan.buffers) udp.send(b, rinfo.port, rinfo.address);
    };
    if (plan.delayMs > 0) setTimeout(out, plan.delayMs);
    else out();
  });
  await new Promise((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(tcpPort, host, () => {
      udp.off('error', reject);
      resolve();
    });
  });

  const control = createControl(sim);
  const ctlPort = await listen(control, controlPort, controlHost);
  return {
    port: tcpPort,
    controlPort: ctlPort,
    server: sim,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => tcp.close(r));
      await new Promise((r) => udp.close(r));
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
      port: Number(a.port ?? 9600),
      controlPort: Number(a.control ?? 9601),
      host: a.host ?? '0.0.0.0',
      controlHost: a['control-host'] ?? '127.0.0.1',
      logFile: a.log ?? null,
    });
    console.log(`fins-sim: udp+tcp ${s.port}, control ${s.controlPort}`);
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    console.error(`fins-sim: ${e.message}`);
    process.exit(2);
  }
}
