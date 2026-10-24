// Control API of the FINS simulator (feature 018), JSON over HTTP, as tools/modbus-sim:
//   POST /fault    { kind, command?, from?, to?, count?, skip?, delayMs?, endCode?, transport?, error? }
//                  kind "clear" removes every fault (and the refusal of the TCP handshake)
//   DELETE /fault  the same as kind "clear"
//   GET /faults    the faults waiting
//   GET /counters  commands, responses, endCodes, faults, byCommand, udp, tcp, handshakes, bytes
//   GET /log?since=<seq>   { entries: [{ seq, ts, transport, command, sid, code, address, bit, count, items, result }] }
//   POST /set      { area, address, value | values: [...] }   area CIO, W, H, A, D, E0..EC, T, C
//   POST /flag     { area: "T" | "C", address, value }
//   GET /mem?area=&address=&count=
//   POST /status   { plc: 0 | 64 | 128 }   the PLC error bits of SRES on every answer
//   POST /reset    faults, counters, log
import http from 'node:http';
import { AREAS } from './memory.mjs';

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
    try {
      if (req.method === 'POST' && url.pathname === '/fault') {
        const f = await readJson(req);
        if (typeof f !== 'object' || f === null || typeof f.kind !== 'string')
          return send(res, 400, { error: 'kind is required' });
        try {
          sim.addFault(f);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        return send(res, 200, { ok: true, faults: sim.faults.length, tcpError: sim.tcpError });
      }
      if (req.method === 'DELETE' && url.pathname === '/fault') {
        sim.clearFaults();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/faults')
        return send(res, 200, { faults: sim.faults, tcpError: sim.tcpError });
      if (req.method === 'GET' && url.pathname === '/counters')
        return send(res, 200, sim.counters());
      if (req.method === 'GET' && url.pathname === '/log')
        return send(res, 200, {
          entries: sim.logEntries(Number(url.searchParams.get('since') ?? 0)),
        });
      if (req.method === 'POST' && url.pathname === '/reset') {
        sim.reset();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/status') {
        const b = await readJson(req);
        sim.plcStatus = Number(b.plc ?? 0) & 0xc0;
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/set') {
        const b = await readJson(req);
        if (!AREAS.includes(b.area) || !Number.isInteger(b.address))
          return send(res, 400, { error: 'area, address are required' });
        const values = b.values ?? [b.value];
        if (!values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff))
          return send(res, 400, { error: 'values are words 0-65535' });
        values.forEach((v, i) => sim.memory.set(b.area, b.address + i, v));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/flag') {
        const b = await readJson(req);
        try {
          sim.memory.setFlag(b.area, b.address, b.value);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/mem') {
        const area = url.searchParams.get('area');
        const address = Number(url.searchParams.get('address'));
        const count = Number(url.searchParams.get('count') ?? 1);
        if (!AREAS.includes(area) || !Number.isInteger(address) || !(count >= 1 && count <= 999))
          return send(res, 400, { error: 'bad query' });
        const values = [];
        for (let i = 0; i < count; i++) values.push(sim.memory.get(area, address + i));
        return send(res, 200, { values });
      }
      return send(res, 404, { error: 'no such route' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
}
