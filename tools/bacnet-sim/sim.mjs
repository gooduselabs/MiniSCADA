// BACnet/IP device simulator for the tests of feature 020. Node >= 22, no package. Only for tests: it holds the
// objects of one or more BACnet devices (server.mjs), answers RP / RPM / WP / Who-Is on UDP and breaks on command.
//
//   node tools/bacnet-sim/sim.mjs --port 47808 --control 8090 --map tools/bacnet-sim/maps/all-types.json
//        [--broadcast 172.30.20.255] [--host 0.0.0.0] [--control-host 127.0.0.1] [--log requests.jsonl]
//
// I-Am goes back to the sender of the Who-Is and, with --broadcast, to that address on port 47808 too.
//
// Control API (JSON over HTTP):
//   POST /fault    { kind: drop (count) | dropAll (on) | delay (ms) | error (code) | maxApdu (value) | noRpm (on) | clear }
//   DELETE /fault  the same as kind "clear"
//   POST /set      { device, object: "AV:5", value?, flags?, outOfService?, priority? }
//   GET /get?device=1001&object=AV:5
//   GET /counters  requests, responses, dropped, byService, errors, whoIs, registrations
//   GET /log?since=<seq>
//   POST /reset    faults, counters, log
import dgram from 'node:dgram';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { SimServer } from './server.mjs';

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text.trim() === '' ? {} : JSON.parse(text));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createControl(sim) {
  const send = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/fault') {
        const f = await readJson(req);
        if (typeof f?.kind !== 'string') return send(res, 400, { error: 'kind is required' });
        try {
          sim.addFault(f);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        return send(res, 200, { ok: true, faults: sim.faults });
      }
      if (req.method === 'DELETE' && url.pathname === '/fault') {
        sim.addFault({ kind: 'clear' });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/set') {
        const b = await readJson(req);
        try {
          return send(res, 200, sim.set(b.device, b.object, b));
        } catch (e) {
          return send(res, 404, { error: e.message });
        }
      }
      if (req.method === 'GET' && url.pathname === '/get') {
        const o = sim.object(
          Number(url.searchParams.get('device')),
          url.searchParams.get('object'),
        );
        return o ? send(res, 200, sim.describe(o)) : send(res, 404, { error: 'no such object' });
      }
      if (req.method === 'GET' && url.pathname === '/counters') return send(res, 200, sim.counters);
      if (req.method === 'GET' && url.pathname === '/log') {
        const since = Number(url.searchParams.get('since') ?? 0);
        return send(res, 200, { entries: sim.log.filter((e) => e.seq > since) });
      }
      if (req.method === 'POST' && url.pathname === '/reset') {
        sim.addFault({ kind: 'clear' });
        sim.counters = {
          requests: 0,
          responses: 0,
          dropped: 0,
          byService: {},
          errors: 0,
          whoIs: 0,
          registrations: 0,
        };
        sim.log = [];
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
}

/** Starts the simulator. Port 0 takes free ports. Returns { port, controlPort, sim, close() }. */
export async function startSim({
  map,
  port = 47808,
  controlPort = 8090,
  host = '0.0.0.0',
  controlHost = '127.0.0.1',
  broadcast = null,
  logFile = null,
}) {
  const json = typeof map === 'string' ? JSON.parse(readFileSync(map, 'utf8')) : map;
  if (logFile) writeFileSync(logFile, '');
  const sim = new SimServer({
    map: json,
    onLog: logFile ? (e) => appendFileSync(logFile, JSON.stringify(e) + '\n') : null,
  });
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const timers = new Set();
  udp.on('message', (msg, rinfo) => {
    for (const r of sim.handle(msg, { address: rinfo.address, port: rinfo.port })) {
      const go = () => {
        udp.send(r.data, r.port, r.address);
        if (r.broadcast && broadcast) udp.send(r.data, 47808, broadcast);
      };
      if (r.delayMs > 0) {
        const t = setTimeout(() => {
          timers.delete(t);
          go();
        }, r.delayMs);
        timers.add(t);
      } else {
        go();
      }
    }
  });
  await new Promise((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(port, host, () => {
      udp.off('error', reject);
      if (broadcast) udp.setBroadcast(true);
      resolve();
    });
  });
  const control = createControl(sim);
  await new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(controlPort, controlHost, () => {
      control.off('error', reject);
      resolve();
    });
  });
  return {
    port: udp.address().port,
    controlPort: control.address().port,
    sim,
    close: () =>
      new Promise((resolve) => {
        for (const t of timers) clearTimeout(t);
        udp.close();
        control.close(() => resolve());
      }),
  };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = args(process.argv.slice(2));
  const s = await startSim({
    map:
      a.map ??
      new URL('./maps/all-types.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    port: Number(a.port ?? 47808),
    controlPort: Number(a.control ?? 8090),
    host: a.host ?? '0.0.0.0',
    controlHost: a['control-host'] ?? '127.0.0.1',
    broadcast: a.broadcast ?? null,
    logFile: a.log ?? null,
  });
  console.log(
    `bacnet-sim: udp ${s.port}, control ${s.controlPort}, ${s.sim.devices.length} device(s)`,
  );
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
