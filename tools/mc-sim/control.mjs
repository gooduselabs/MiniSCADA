// Control API of the MC protocol simulator (contracts/mc-protocol.md §5), JSON over HTTP:
//   GET  /state     { xyNotation, routes, devices: { D: { size, kind } }, faults, refusing, counters }
//   GET  /mem?device=D&at=100&count=4   { device, at, values } (words, or 0/1 points); at is the
//                   device number in decimal (X1A0 -> at=416)
//   GET  /mem?device=D&at=100&type=INT32[&length=n]   { device, at, type, value }
//   POST /set       { device, at, type?, length?, value | values, bit? }
//                   type: typed write like the map; no type: raw words (word device) or points
//                   (bit device); bit 0-15: one bit of a word device. `at` is a number or a string
//                   in the Tag notation (X/Y/B/W hex, ZR decimal).
//   POST /fault     { mode, code?, device?, from?, to?, at?, count?, delayMs?, bytes? }
//                   mode: silent | close | endcode | delay | garbage | refuse | none | clear
//   DELETE /fault   removes every fault and the refusal
//   GET  /faults    { faults, refusing }
//   GET  /counters  (also GET /stats) { requests, responses, unanswered, badFrames, faults,
//                   byCommand: { "0401": n }, endCodes: { "0000": n, "C056": n },
//                   connections: { accepted, closed, current }, bytesIn, bytesOut, last }
//   GET  /log?since=<seq>   { entries: [{ seq, ts, transport, frame, code, cmd, sub, serial?,
//                   device?, at?, points?, n?, m?, data?, route, endCode, result }] }
//   POST /reset     faults, refusal, counters and log (not the memory)
import http from 'node:http';
import { DEVICES, TYPES } from './map.mjs';

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1048576) reject(new Error('body too large'));
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

function setMemory(sim, b) {
  const mem = sim.memory;
  if (typeof b !== 'object' || b === null || !mem.device(b.device))
    throw new Error('device must be a device of the map');
  const at = mem.number(b.device, b.at);
  const bit = DEVICES[b.device].bit;
  if (b.type !== undefined) {
    if (bit) throw new Error('type is for word devices');
    if (!TYPES.includes(b.type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
    return mem.setTyped(b.device, at, b.type, b.value, b.length);
  }
  const values = b.values ?? [b.value];
  if (!values.every((v) => typeof v === 'number' || typeof v === 'boolean'))
    throw new Error('value must be a number or a boolean');
  if (!mem.inRange(b.device, at, values.length)) throw new Error('out of range');
  if (b.bit !== undefined) {
    if (bit || !Number.isInteger(b.bit) || b.bit < 0 || b.bit > 15)
      throw new Error('bit must be 0-15 on a word device');
    const cur = mem.get(b.device, at, sim.now());
    mem.set(b.device, at, values[0] ? cur | (1 << b.bit) : cur & ~(1 << b.bit));
    return [mem.get(b.device, at)];
  }
  values.forEach((v, i) => mem.set(b.device, at + i, Number(v)));
  return values.map(Number);
}

function readMemory(sim, q) {
  const mem = sim.memory;
  const device = q.get('device');
  if (!mem.device(device)) throw new Error('device must be a device of the map');
  const at = Number(q.get('at'));
  if (!Number.isInteger(at) || at < 0) throw new Error('at must be a device number (decimal)');
  const type = q.get('type');
  if (type) {
    if (!TYPES.includes(type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
    const length = q.get('length') === null ? undefined : Number(q.get('length'));
    return { device, at, type, value: mem.getTyped(device, at, type, length, sim.now()) };
  }
  const count = Number(q.get('count') ?? 1);
  if (!(Number.isInteger(count) && count >= 1 && count <= 8192))
    throw new Error('count must be 1-8192');
  if (!mem.inRange(device, at, count)) throw new Error('out of range');
  const values = [];
  for (let i = 0; i < count; i++) values.push(mem.get(device, at + i, sim.now()));
  return { device, at, values };
}

export function createControl(sim) {
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
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /state':
          return send(res, 200, {
            xyNotation: sim.memory.xyNotation,
            routes: sim.memory.routes,
            devices: Object.fromEntries(
              [...sim.memory.devices].map(([n, d]) => [
                n,
                { size: d.size, kind: d.info.bit ? 'bit' : 'word' },
              ]),
            ),
            faults: sim.faults,
            refusing: sim.refusing,
            counters: sim.counters(),
          });
        case 'GET /mem':
          return send(res, 200, readMemory(sim, url.searchParams));
        case 'POST /set': {
          const words = setMemory(sim, await readJson(req));
          return send(res, 200, { ok: true, written: words });
        }
        case 'POST /fault': {
          const f = await readJson(req);
          if (typeof f !== 'object' || f === null || typeof f.mode !== 'string')
            return send(res, 400, { error: 'mode is required' });
          sim.addFault(f);
          return send(res, 200, { ok: true, faults: sim.faults.length, refusing: sim.refusing });
        }
        case 'DELETE /fault':
          sim.clearFaults();
          return send(res, 200, { ok: true });
        case 'GET /faults':
          return send(res, 200, { faults: sim.faults, refusing: sim.refusing });
        case 'GET /counters':
        case 'GET /stats':
          return send(res, 200, sim.counters());
        case 'GET /log':
          return send(res, 200, {
            entries: sim.logEntries(Number(url.searchParams.get('since') ?? 0)),
          });
        case 'POST /reset':
          sim.reset();
          return send(res, 200, { ok: true });
        default:
          return send(res, 404, { error: 'no such route' });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
}
