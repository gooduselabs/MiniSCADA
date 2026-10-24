// Control API of the S7 simulator (contracts/s7-driver.md §6), JSON over HTTP:
//   POST /fault    { kind: silent|close|delay|garbage|refuse|putget, count?, delayMs? }
//                  silent: no answer; close: the socket is closed; delay: the answer comes delayMs
//                  late; garbage: bytes that are not a TPKT; refuse: no listening (new connections
//                  fail, open ones are dropped); putget: header error 81 04 for Read/Write Var.
//                  silent/close/delay/garbage take the next `count` requests (all, without count).
//   DELETE /fault  removes every fault, the refusal and putget
//   GET /faults    { faults, refusing, putget }
//   GET /counters  { connections, connectionsOpen, requests, byFunction, items, maxRequestPdu,
//                    maxResponsePdu, pduSize, errors, faults, rejected }
//   GET /log?since=<seq>   { entries: [{ seq, ts, fn, ref, items: [{ area, db, byte, bit, size }], result, data? }] }
//   POST /set      { area: "DB1" | "M" | "I" | "Q", byte, type, bit?, maxLength?, length?, value }
//   GET /mem?area=&byte=&count=   { hex: "01 02 ..." }
//   POST /reset    { memory? }  faults, counters and log; memory: true also the values of the map
import http from 'node:http';
import { areaName } from './map.mjs';

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

const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

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
        case 'POST /fault': {
          const f = await readJson(req);
          if (typeof f !== 'object' || f === null || typeof f.kind !== 'string')
            return send(res, 400, { error: 'kind is required' });
          sim.addFault(f);
          return send(res, 200, { ok: true, faults: sim.faults.length, refusing: sim.refusing });
        }
        case 'DELETE /fault':
          sim.clearFaults();
          return send(res, 200, { ok: true });
        case 'GET /faults':
          return send(res, 200, { faults: sim.faults, refusing: sim.refusing, putget: sim.putget });
        case 'GET /counters':
          return send(res, 200, sim.counters());
        case 'GET /log':
          return send(res, 200, {
            entries: sim.logEntries(Number(url.searchParams.get('since') ?? 0)),
          });
        case 'POST /reset': {
          const b = await readJson(req);
          sim.reset({ memory: b?.memory === true });
          return send(res, 200, { ok: true });
        }
        case 'POST /set': {
          const b = await readJson(req);
          if (!areaName(b?.area)) return send(res, 400, { error: 'area must be DB<n>, M, I or Q' });
          sim.memory.set(b.area, b);
          return send(res, 200, { ok: true });
        }
        case 'GET /mem': {
          const buf = sim.memory.area(areaName(url.searchParams.get('area')));
          const byte = Number(url.searchParams.get('byte') ?? 0);
          const count = Number(url.searchParams.get('count') ?? 1);
          if (!buf) return send(res, 404, { error: 'no such area' });
          if (!Number.isInteger(byte) || !Number.isInteger(count) || byte < 0 || count < 1)
            return send(res, 400, { error: 'bad query' });
          if (byte + count > buf.length) return send(res, 400, { error: 'beyond the size' });
          sim.memory.tick(sim.now());
          return send(res, 200, { hex: hex(buf.subarray(byte, byte + count)) });
        }
        default:
          return send(res, 404, { error: 'no such route' });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
}
