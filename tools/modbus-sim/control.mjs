// Control API of the simulator (contracts/modbus-driver.md §12), JSON over HTTP:
//   POST /fault    { kind, unit?, fc?, from?, to?, count?, delayMs?, code?, bytes? }   kind "clear" removes all
//   DELETE /fault  removes every fault and the refusal
//   GET /faults    the faults waiting
//   GET /counters  requests, responses, exceptions, faults, byFc, connections, bytes
//   GET /log?since=<seq>   the requests: { entries: [{ seq, ts, unit, fc, address, quantity, tid, result }] }
//   POST /set      { unit, area, address, value | values: [...] }
//   GET /mem?unit=&area=&address=&count=
//   POST /reset    faults, counters, log and unit states
//   POST /unit     { unit, state: "mute" | "late" | "ok", delayMs? }   one unit of a gateway (feature 011)
//   GET /units     the units that are mute or late
import http from 'node:http';
import { AREAS } from './map.mjs';

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
        return send(res, 200, { ok: true, faults: sim.faults.length, refusing: sim.refusing });
      }
      if (req.method === 'DELETE' && url.pathname === '/fault') {
        sim.clearFaults();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/faults')
        return send(res, 200, { faults: sim.faults, refusing: sim.refusing });
      if (req.method === 'GET' && url.pathname === '/counters')
        return send(res, 200, sim.counters());
      if (req.method === 'GET' && url.pathname === '/log')
        return send(res, 200, {
          entries: sim.logEntries(Number(url.searchParams.get('since') ?? 0)),
        });
      if (req.method === 'POST' && url.pathname === '/unit') {
        const b = await readJson(req);
        try {
          sim.setUnit(b);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        return send(res, 200, { ok: true, units: sim.units() });
      }
      if (req.method === 'GET' && url.pathname === '/units')
        return send(res, 200, { units: sim.units() });
      if (req.method === 'POST' && url.pathname === '/reset') {
        sim.reset();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/set') {
        const b = await readJson(req);
        if (!AREAS.includes(b.area) || !Number.isInteger(b.unit) || !Number.isInteger(b.address))
          return send(res, 400, { error: 'unit, area, address are required' });
        const values = b.values ?? [b.value];
        if (!values.every((v) => typeof v === 'number' || typeof v === 'boolean'))
          return send(res, 400, { error: 'value must be a number' });
        values.forEach((v, i) => sim.memory.set(b.unit, b.area, b.address + i, Number(v)));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/mem') {
        const unit = Number(url.searchParams.get('unit'));
        const area = url.searchParams.get('area');
        const address = Number(url.searchParams.get('address'));
        const count = Number(url.searchParams.get('count') ?? 1);
        if (
          !AREAS.includes(area) ||
          !Number.isInteger(unit) ||
          !Number.isInteger(address) ||
          !(count >= 1 && count <= 2000)
        )
          return send(res, 400, { error: 'bad query' });
        const values = [];
        for (let i = 0; i < count; i++)
          values.push(sim.memory.value(unit, area, address + i, sim.now()) ?? null);
        return send(res, 200, { values });
      }
      return send(res, 404, { error: 'no such route' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
}
