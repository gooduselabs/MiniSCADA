// MC protocol (SLMP) simulator for the tests of feature 017 (contracts/mc-protocol.md §5). Node >= 22,
// no package. Only for tests: it holds PLC-like memory, answers 3E/4E frames, binary and ASCII, on
// the same port (TCP stream and UDP datagrams), and breaks on command (control.mjs).
//
//   node tools/mc-sim/sim.mjs --tcp 5007 [--udp 5008] --control 5009 --map tools/mc-sim/maps/all-types.json
//        [--log requests.jsonl] [--host 0.0.0.0] [--control-host 127.0.0.1]
//        [--frame 3E|4E|auto] [--code binary|ascii|auto]
// --frame/--code: only that kind of frame is answered (others are dropped, counted in badFrames).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import dgram from 'node:dgram';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { splitFrames } from './codec.mjs';
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

const bindUdp = (sock, port, host) =>
  new Promise((resolve, reject) => {
    const onError = (e) => reject(e);
    sock.once('error', onError);
    sock.bind(port, host, () => {
      sock.off('error', onError);
      sock.on('error', () => {});
      resolve(sock.address().port);
    });
  });

/**
 * Starts the simulator. `map`: the map object or a path to a JSON file. Port 0 takes a free port;
 * udpPort null (default) opens no UDP socket. Returns { tcpPort, udpPort, controlPort, server, close() }.
 */
export async function startSim({
  map,
  tcpPort = 5007,
  udpPort = null,
  controlPort = 5009,
  host = '0.0.0.0',
  controlHost = '127.0.0.1',
  logFile = null,
  now = Date.now,
  frame = 'auto',
  code = 'auto',
}) {
  const json = typeof map === 'string' ? JSON.parse(readFileSync(map, 'utf8')) : map;
  if (logFile) writeFileSync(logFile, '');
  const sockets = new Set();
  let tcp = null;
  let port = tcpPort;
  const sim = new SimServer({
    memory: loadMap(json),
    now,
    accept: { frame, code },
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
      sim.connOpened();
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const r = splitFrames(buf);
        buf = Buffer.from(r.rest);
        if (r.lost) sim.stats.badFrames++;
        for (const f of r.frames) {
          const plan = sim.handleFrame(f, 'tcp');
          if (plan.action === 'close') {
            sock.destroy();
            return;
          }
          if (plan.action !== 'respond') continue;
          const send = () => {
            if (!sock.destroyed) for (const b of plan.buffers) sock.write(b);
          };
          if (plan.delayMs > 0) setTimeout(send, plan.delayMs);
          else send();
        }
        if (r.lost) sock.destroy();
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

  let udp = null;
  let uPort = null;
  if (udpPort !== null && udpPort !== undefined) {
    udp = dgram.createSocket('udp4');
    udp.on('message', (msg, rinfo) => {
      if (sim.refusing) return;
      const r = splitFrames(msg);
      if (r.lost || r.frames.length !== 1 || r.rest.length !== 0) {
        sim.stats.badFrames++;
        return;
      }
      const plan = sim.handleFrame(r.frames[0], 'udp');
      if (plan.action !== 'respond') return;
      const send = () => {
        for (const b of plan.buffers) udp.send(b, rinfo.port, rinfo.address);
      };
      if (plan.delayMs > 0) setTimeout(send, plan.delayMs);
      else send();
    });
    uPort = await bindUdp(udp, udpPort, host);
  }

  const control = createControl(sim);
  const ctlPort = await listen(control, controlPort, controlHost);
  return {
    tcpPort: port,
    udpPort: uPort,
    controlPort: ctlPort,
    server: sim,
    async close() {
      stopTcp();
      if (udp) await new Promise((r) => udp.close(r));
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
    const frame = a.frame ?? 'auto';
    const code = a.code ?? 'auto';
    if (!['3E', '4E', 'auto'].includes(frame)) throw new Error('--frame must be 3E, 4E or auto');
    if (!['binary', 'ascii', 'auto'].includes(code))
      throw new Error('--code must be binary, ascii or auto');
    const s = await startSim({
      map: a.map,
      tcpPort: Number(a.tcp ?? 5007),
      udpPort: a.udp === undefined ? null : Number(a.udp),
      controlPort: Number(a.control ?? 5009),
      host: a.host ?? '0.0.0.0',
      controlHost: a['control-host'] ?? '127.0.0.1',
      logFile: a.log ?? null,
      frame,
      code,
    });
    console.log(
      `mc-sim: tcp ${s.tcpPort}${s.udpPort !== null ? `, udp ${s.udpPort}` : ''}, control ${s.controlPort}`,
    );
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    console.error(`mc-sim: ${e.message}`);
    process.exit(2);
  }
}
