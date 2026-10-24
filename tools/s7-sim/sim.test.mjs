// Tests of the S7comm simulator (specs/016-driver-s7; contracts/s7-driver.md §3, §6). `node --test`.
// The simulator's own codec runs over every applicable vector of tests/s7-vectors/frames.json.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decodeValue,
  encodeCc,
  encodeCr,
  encodeDr,
  encodeValue,
  headerError,
  parseCotp,
  parseJob,
  parseS7,
  readRequest,
  readResponse,
  setBit,
  setupRequest,
  setupResponse,
  splitTpkt,
  wrapDt,
  writeRequest,
  writeResponse,
} from './codec.mjs';
import { loadMap } from './map.mjs';
import { SimServer } from './server.mjs';
import { startSim } from './sim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(join(here, '..', '..', 'tests', 's7-vectors', 'frames.json'), 'utf8'),
);
const mapFile = (f) => join(here, 'maps', f);
const mapJson = (f) => JSON.parse(readFileSync(mapFile(f), 'utf8'));
const bytes = (h) =>
  Buffer.from(
    h.trim() === ''
      ? []
      : h
          .trim()
          .split(/\s+/)
          .map((x) => parseInt(x, 16)),
  );
const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
/** The S7 PDU of a vector frame (TPKT + DT). */
const pduOf = (h) => {
  const c = parseCotp(bytes(h));
  assert.equal(c.type, 'DT');
  return c.payload;
};
const strip = (it) => ({ area: it.area, db: it.db, byte: it.byte, bit: it.bit, size: it.size });

describe('codec on the shared vectors', () => {
  it('cotpConnect: CR parses to the TSAPs and encodes back', () => {
    for (const c of V.cotpConnect) {
      const cr = parseCotp(bytes(c.hex));
      assert.equal(cr.type, 'CR', c.name);
      assert.equal(cr.localTsap, c.localTsap, c.name);
      assert.equal(cr.remoteTsap, c.remoteTsap, c.name);
      assert.equal(hex(encodeCr(c.localTsap, c.remoteTsap)), c.hex, c.name);
    }
  });

  it('tsap: remote = 0x0100 | rack << 5 | slot', () => {
    for (const c of V.tsap) {
      const t = (0x0100 | (c.rack << 5) | c.slot).toString(16).toUpperCase().padStart(4, '0');
      assert.equal(t, c.remote);
    }
  });

  it('cotpConfirm: only CC is accepted; the CC and DR of the simulator are the vector bytes', () => {
    for (const c of V.cotpConfirm)
      assert.equal(parseCotp(bytes(c.hex)).type === 'CC', c.expect.accepted, c.name);
    const cr = parseCotp(bytes(V.cotpConnect[0].hex));
    const named = (n) => V.cotpConfirm.find((c) => c.name === n).hex;
    assert.equal(hex(encodeCc(cr)), named('cc-echo-params'));
    assert.equal(hex(encodeDr(cr)), named('dr-refused'));
  });

  it('setupRequest parses to ref and PDU size and encodes back', () => {
    for (const c of V.setupRequest) {
      const job = parseJob(pduOf(c.hex));
      assert.equal(job.fn, 0xf0, c.name);
      assert.equal(job.ref, c.ref, c.name);
      assert.equal(job.pduSize, c.pduSize, c.name);
      assert.equal(hex(wrapDt(setupRequest(c.ref, c.pduSize))), c.hex, c.name);
    }
  });

  it('setupResponse: the valid answers and the header error are built byte for byte', () => {
    let built = 0;
    for (const c of V.setupResponse) {
      if (c.expect.format) {
        assert.notEqual(parseS7(pduOf(c.hex)).param[0], 0xf0, c.name);
        continue;
      }
      const s7 = parseS7(pduOf(c.hex));
      const out = c.expect.ok
        ? setupResponse(
            c.expect.ref,
            s7.param.readUInt16BE(2),
            s7.param.readUInt16BE(4),
            c.expect.pduSize,
          )
        : headerError(c.expect.ref, c.expect.error >> 8, c.expect.error & 0xff);
      assert.equal(hex(wrapDt(out)), c.hex, c.name);
      built++;
    }
    assert.equal(built, 3);
  });

  it('readRequest parses to the items and encodes back', () => {
    for (const c of V.readRequest) {
      const job = parseJob(pduOf(c.hex));
      assert.equal(job.fn, 0x04, c.name);
      assert.equal(job.ref, c.ref, c.name);
      assert.deepEqual(job.items.map(strip), c.items, c.name);
      assert.equal(hex(wrapDt(readRequest(c.ref, c.items))), c.hex, c.name);
    }
  });

  it('readResponse: every answer the simulator can give is built byte for byte', () => {
    // items answered as a bit (ts 03); the simulator never answers ts 09 (octet string)
    const bitItems = { 'odd-item-then-bit-fill-byte': [1] };
    const notMine = ['octet-string-length-in-bytes'];
    let built = 0;
    for (const c of V.readResponse) {
      if (c.expect.format || notMine.includes(c.name)) continue;
      let out;
      if (c.expect.ok) {
        const results = c.expect.items.map((r, i) => ({
          rc: r.rc,
          bit: (bitItems[c.name] ?? []).includes(i),
          data: bytes(r.data),
        }));
        out = readResponse(c.expect.ref, results);
      } else {
        const rosctr = bytes(c.hex)[8];
        out = headerError(c.expect.ref, c.expect.error >> 8, c.expect.error & 0xff, rosctr);
      }
      assert.equal(hex(wrapDt(out)), c.hex, c.name);
      built++;
    }
    assert.equal(built, 6);
    assert.equal(
      parseS7(pduOf(V.readResponse.find((c) => c.name === 'not-s7-protocol-id').hex)),
      null,
    );
  });

  it('writeRequest parses to the item and its data and encodes back', () => {
    for (const c of V.writeRequest) {
      const job = parseJob(pduOf(c.hex));
      assert.equal(job.fn, 0x05, c.name);
      assert.equal(job.ref, c.ref, c.name);
      assert.equal(job.items.length, 1, c.name);
      assert.deepEqual(strip(job.items[0]), c.item, c.name);
      assert.equal(hex(job.items[0].data), c.data, c.name);
      const req = writeRequest(c.ref, [{ ...c.item, data: bytes(c.data) }]);
      assert.equal(hex(wrapDt(req)), c.hex, c.name);
    }
  });

  it('writeResponse: the valid answers and the header error are built byte for byte', () => {
    for (const c of V.writeResponse) {
      if (c.expect.format) continue;
      const out = c.expect.ok
        ? writeResponse(c.expect.ref, [c.expect.rc])
        : headerError(c.expect.ref, c.expect.error >> 8, c.expect.error & 0xff);
      assert.equal(hex(wrapDt(out)), c.hex, c.name);
    }
  });

  it('split: TPKT frames are cut by their length; a bad header is reported', () => {
    for (const c of V.split) {
      const r = splitTpkt(bytes(c.hex));
      assert.deepEqual(
        r.frames.map((f) => f.length),
        c.expect.frames,
        c.name,
      );
      assert.equal(r.rest.length, c.expect.rest, c.name);
      assert.equal(r.bad, c.expect.bad, c.name);
    }
  });

  it('values decode, and encode back where the vector allows it', () => {
    for (const c of V.values) {
      const b = bytes(c.bytes);
      const v = decodeValue(c.s7Type, b, { bit: c.bit, length: c.length });
      if (c.invalid) {
        assert.ok(!Number.isFinite(v), c.name);
        continue;
      }
      assert.equal(v, c.value, c.name);
      if (c.decodeOnly) continue;
      if (c.s7Type === 'BOOL') {
        assert.equal(setBit(c.value ? 0x00 : 0xff, c.bit, c.value), b[0], c.name);
        continue;
      }
      assert.equal(hex(encodeValue(c.s7Type, c.value, c.length)), c.encodes ?? c.bytes, c.name);
    }
    for (const c of V.encodeErrors)
      assert.throws(() => encodeValue(c.s7Type, c.value, c.length), c.name);
  });
});

describe('device model on the vector requests', () => {
  const conn = (json) => {
    const sim = new SimServer({ memory: loadMap(json), now: () => 0 });
    const c = sim.connOpened();
    c.handleFrame(bytes(V.cotpConnect[0].hex));
    return { sim, c };
  };
  const answer = (c, reqName, list) =>
    hex(c.handleFrame(bytes(V[list].find((x) => x.name === reqName).hex)).buffers[0]);
  const vecHex = (list, name) => V[list].find((x) => x.name === name).hex;

  it('answers the vector read requests with the vector responses', () => {
    const { c } = conn({
      areas: {
        DB1: { size: 8, data: [{ byte: 0, type: 'REAL', value: 123.456 }] },
        I: { size: 8, data: [{ byte: 2, type: 'WORD', value: 0x1234 }] },
      },
    });
    assert.equal(
      answer(c, 'db1-4-bytes', 'readRequest'),
      vecHex('readResponse', 'one-item-4-bytes'),
    );
    const { c: c2 } = conn({
      areas: { I: { size: 8, data: [{ byte: 2, type: 'WORD', value: 0x1234 }] } },
    });
    assert.equal(
      answer(c2, 'two-items-db-and-input', 'readRequest'),
      vecHex('readResponse', 'item-error-then-ok'),
    );
  });

  it('answers the vector write requests with the vector responses and writes the data', () => {
    const { sim, c } = conn({ areas: { DB1: { size: 8 } } });
    assert.equal(answer(c, 'bit-db1-dbx2-1-true', 'writeRequest'), vecHex('writeResponse', 'ok'));
    assert.equal(sim.memory.area('DB1')[2], 0x02);
    const { c: c2 } = conn({ areas: {} });
    assert.equal(
      answer(c2, 'word-db1-dbw4-1234', 'writeRequest'),
      vecHex('writeResponse', 'object-not-found'),
    );
  });

  it('negotiates min(requested, map) and echoes the setup', () => {
    const { sim, c } = conn({ pduSize: 240, areas: {} });
    assert.equal(
      answer(c, 'pdu-480-ref-1', 'setupRequest'),
      vecHex('setupResponse', 's7-1200-pdu-240'),
    );
    assert.equal(sim.counters().pduSize, 240);
  });
});

// ---- over TCP ----

class Client {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.closed = false;
    this.ref = 0;
    sock.on('data', (d) => {
      const r = splitTpkt(Buffer.concat([this.buf, d]));
      this.buf = r.rest;
      this.frames.push(...r.frames);
      this.flush();
    });
    sock.on('close', () => {
      this.closed = true;
      this.flush();
    });
    sock.on('error', () => {});
  }
  flush() {
    while (this.waiters.length && (this.frames.length || this.closed)) {
      const w = this.waiters.shift();
      clearTimeout(w.timer);
      w.resolve(this.frames.length ? this.frames.shift() : 'closed');
    }
  }
  /** The next frame, 'closed', or null after `ms`. */
  next(ms = 500) {
    return new Promise((resolve) => {
      const w = { resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        resolve(null);
      }, ms);
      this.waiters.push(w);
      this.flush();
    });
  }
  async cr(remote = '0101') {
    this.sock.write(encodeCr('0100', remote));
    return parseCotp(await this.next());
  }
  /** Sends an S7 PDU, gives back the parsed answer (or null / 'closed'). */
  async s7(pdu, ms) {
    this.sock.write(wrapDt(pdu));
    const f = await this.next(ms);
    if (!f || f === 'closed') return f;
    return parseS7(parseCotp(f).payload);
  }
  async setup(pdu = 480) {
    const r = await this.s7(setupRequest(++this.ref, pdu));
    return r.param.readUInt16BE(6);
  }
  read(items) {
    return this.s7(readRequest(++this.ref, items));
  }
  write(items) {
    return this.s7(writeRequest(++this.ref, items));
  }
  end() {
    this.sock.destroy();
  }
}

/** Items of a Read Var answer: [{ rc, data }]. */
function items(r) {
  const out = [];
  let at = 0;
  for (let i = 0; i < r.param[1]; i++) {
    const rc = r.data[at];
    const ts = r.data[at + 1];
    const len = r.data.readUInt16BE(at + 2);
    const n = rc !== 0xff ? 0 : ts === 3 || ts === 4 || ts === 5 ? Math.ceil(len / 8) : len;
    out.push({ rc, data: r.data.subarray(at + 4, at + 4 + n) });
    at += 4 + n + (n % 2 === 1 ? 1 : 0);
  }
  return out;
}
const err = (r) => (r.eclass << 8) | r.ecode;
const DB = (db, byte, size, bit = null) => ({ area: 'DB', db, byte, bit, size });
const A = (area, byte, size, bit = null) => ({ area, db: 0, byte, bit, size });

describe('over TCP, with the control API', () => {
  const sims = [];
  after(async () => {
    for (const s of sims) await s.close();
  });
  async function boot(map = 'all-types.json', opts = {}) {
    const s = await startSim({
      map: typeof map === 'string' ? mapFile(map) : map,
      tcpPort: 0,
      controlPort: 0,
      host: '127.0.0.1',
      ...opts,
    });
    sims.push(s);
    return s;
  }
  const ctl = async (s, method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${s.controlPort}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    return { status: r.status, json: await r.json() };
  };
  const connect = (s) =>
    new Promise((resolve, reject) => {
      const sock = net.connect(s.tcpPort, '127.0.0.1', () => resolve(new Client(sock)));
      sock.once('error', reject);
    });
  async function session(s, pdu = 480) {
    const c = await connect(s);
    assert.equal((await c.cr()).type, 'CC');
    await c.setup(pdu);
    return c;
  }

  it('connects, negotiates min(requested, map) and reads every type of all-types', async () => {
    const s = await boot();
    const c = await connect(s);
    assert.equal((await c.cr()).type, 'CC');
    assert.equal(await c.setup(960), 480);
    assert.equal(await c.setup(300), 300);
    const r = await c.read([
      DB(1, 0, 1, 0),
      DB(1, 0, 1, 5),
      DB(1, 1, 25),
      DB(1, 26, 5),
      DB(1, 32, 22),
      DB(2, 0, 2),
      A('M', 0, 1, 1),
      A('M', 10, 2),
      A('M', 20, 4),
      A('I', 0, 1, 1),
      A('I', 2, 2),
      A('Q', 0, 1, 0),
      A('Q', 1, 1),
    ]);
    assert.equal(err(r), 0);
    const it = items(r);
    assert.ok(it.every((x) => x.rc === 0xff));
    const d = it[2].data; // DB1 bytes 1..25
    assert.equal(decodeValue('BOOL', it[0].data), true);
    assert.equal(decodeValue('BOOL', it[1].data), false);
    assert.equal(d[0], 200);
    assert.equal(d.readInt16BE(1), -1234);
    assert.equal(d.readUInt16BE(3), 64302);
    assert.equal(d.readInt32BE(5), -100000);
    assert.equal(d.readUInt32BE(9), 4000000000);
    assert.equal(hex(d.subarray(13, 17)), '42 F6 E9 79');
    assert.equal(d.readDoubleBE(17), 3.141592653589793);
    assert.equal(hex(it[3].data), '41 4F 4B 00 00');
    assert.equal(decodeValue('STRING', it[4].data, { length: 20 }), 'Bom 1');
    assert.equal(it[5].data.readInt16BE(0), 42);
    assert.equal(hex(it[6].data), '01');
    assert.equal(it[7].data.readUInt16BE(0), 4660);
    assert.equal(it[8].data.readFloatBE(0), -1.5);
    assert.equal(hex(it[9].data), '01');
    assert.equal(it[10].data.readInt16BE(0), 100);
    assert.equal(hex(it[11].data), '01');
    assert.equal(it[12].data[0], 7);
    c.end();
  });

  it('writes several items and reads them back; GET /mem shows the bytes', async () => {
    const s = await boot();
    const c = await session(s);
    const w = await c.write([
      { ...DB(1, 60, 1, 0), data: Buffer.from([1]) },
      { ...DB(1, 62, 2), data: encodeValue('INT', -7) },
      { ...DB(1, 70, 12), data: encodeValue('STRING', 'Hi', 10) },
      { ...A('M', 20, 4), data: encodeValue('REAL', 2.5) },
    ]);
    assert.equal(hex(w.data), 'FF FF FF FF');
    const it = items(await c.read([DB(1, 60, 1, 0), DB(1, 62, 2), DB(1, 70, 12), A('M', 20, 4)]));
    assert.equal(hex(it[0].data), '01');
    assert.equal(it[1].data.readInt16BE(0), -7);
    assert.equal(decodeValue('STRING', it[2].data, { length: 10 }), 'Hi');
    assert.equal(it[3].data.readFloatBE(0), 2.5);
    assert.equal((await ctl(s, 'GET', '/mem?area=DB1&byte=60&count=4')).json.hex, '01 00 FF F9');
    // a bit write leaves the other bits of its byte alone
    await c.write([{ ...DB(1, 0, 1, 5), data: Buffer.from([1]) }]);
    assert.equal((await ctl(s, 'GET', '/mem?area=db1&byte=0&count=1')).json.hex, '21');
    c.end();
  });

  it('answers item 03 for a denied DB, 0A for a missing DB, 05 beyond the size', async () => {
    const s = await boot();
    const c = await session(s);
    const r = await c.read([DB(3, 0, 2), DB(9, 0, 2), DB(2, 63, 2), A('Q', 16, 1, 0), DB(2, 0, 2)]);
    assert.deepEqual(
      items(r).map((x) => x.rc),
      [0x03, 0x0a, 0x05, 0x05, 0xff],
    );
    const w = await c.write([
      { ...DB(3, 0, 2), data: Buffer.from([1, 2]) },
      { ...DB(9, 0, 2), data: Buffer.from([1, 2]) },
      { ...DB(2, 64, 1), data: Buffer.from([1]) },
    ]);
    assert.equal(hex(w.data), '03 0A 05');
    const log = (await ctl(s, 'GET', '/log')).json.entries;
    assert.equal(log.at(-2).result, 'items:03,0A,05,05,FF');
    assert.deepEqual(log.at(-2).items[0], { area: 'DB', db: 3, byte: 0, bit: null, size: 2 });
    c.end();
  });

  it('putGetDisabled answers header error 81 04 to Read and Write Var', async () => {
    const s = await boot({ ...mapJson('all-types.json'), putGetDisabled: true });
    const c = await session(s);
    assert.equal(err(await c.read([DB(1, 0, 2)])), 0x8104);
    const w = await c.write([{ ...DB(1, 84, 1), data: Buffer.from([9]) }]);
    assert.equal(err(w), 0x8104);
    assert.equal(w.param.length, 0);
    assert.equal((await ctl(s, 'GET', '/counters')).json.errors, 0);
    c.end();
  });

  it('a CR with another remote TSAP gets a DR and the connection closes', async () => {
    const s = await boot({ ...mapJson('all-types.json'), tsap: { remote: '0101' } });
    const bad = await connect(s);
    assert.equal((await bad.cr('0102')).type, 'DR');
    assert.equal(await bad.next(), 'closed');
    const good = await connect(s);
    assert.equal((await good.cr('0101')).type, 'CC');
    assert.equal((await ctl(s, 'GET', '/counters')).json.rejected, 1);
    good.end();
  });

  it('keeps every request and answer within the negotiated PDU (header error 85 00)', async () => {
    const s = await boot('small-pdu.json');
    const c = await connect(s);
    await c.cr();
    assert.equal(await c.setup(480), 240);
    // 12 + 12 * 20 = 252 > 240
    const many = Array.from({ length: 20 }, (_, i) => DB(1, i, 1));
    assert.equal(err(await c.read(many)), 0x8500);
    // 14 + 4 + 230 = 248 > 240
    assert.equal(err(await c.read([DB(1, 0, 230)])), 0x8500);
    const ok = await c.read([DB(1, 0, 222)]); // 14 + 4 + 222 = 240
    assert.equal(items(ok)[0].data.length, 222);
    const cnt = (await ctl(s, 'GET', '/counters')).json;
    assert.equal(cnt.errors, 2);
    assert.equal(cnt.pduSize, 240);
    assert.equal(cnt.maxRequestPdu, 252);
    assert.equal(cnt.maxResponsePdu, 240);
    assert.deepEqual(cnt.byFunction, { setup: 1, read: 3 });
    c.end();
    // more than 20 items on a large PDU
    const s2 = await boot();
    const c2 = await session(s2);
    assert.equal(err(await c2.read(Array.from({ length: 21 }, (_, i) => DB(1, i, 1)))), 0x8500);
    c2.end();
  });

  it('puts DT frames without EOT together, also when bytes come one at a time', async () => {
    const s = await boot();
    const c = await session(s);
    const pdu = readRequest(50, [DB(2, 0, 2)]);
    const part = (p, eot) => {
      const f = Buffer.concat([Buffer.from([3, 0, 0, 0, 2, 0xf0, eot ? 0x80 : 0]), p]);
      f.writeUInt16BE(f.length, 2);
      return f;
    };
    const frames = Buffer.concat([part(pdu.subarray(0, 7), false), part(pdu.subarray(7), true)]);
    for (const b of frames) {
      c.sock.write(Buffer.from([b]));
      await new Promise((r) => setTimeout(r, 1));
    }
    const r = parseS7(parseCotp(await c.next()).payload);
    assert.equal(r.ref, 50);
    assert.equal(items(r)[0].data.readInt16BE(0), 42);
    c.end();
  });

  it('a bad TPKT or a DT before CR closes the connection', async () => {
    const s = await boot();
    const a = await connect(s);
    a.sock.write(Buffer.from('0400000702F080', 'hex'));
    assert.equal(await a.next(), 'closed');
    const b = await connect(s);
    b.sock.write(wrapDt(setupRequest(1, 480)));
    assert.equal(await b.next(), 'closed');
    assert.equal((await ctl(s, 'GET', '/counters')).json.errors, 2);
  });

  it('faults: silent, delay, close, garbage, putget, then DELETE /fault', async () => {
    const s = await boot();
    const c = await session(s);
    const q = [DB(2, 0, 2)];
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'silent', count: 2 })).status, 200);
    assert.equal(await c.s7(readRequest(1, q), 200), null);
    assert.equal(await c.s7(readRequest(2, q), 200), null);
    assert.equal((await c.read(q)).ref, c.ref);

    await ctl(s, 'POST', '/fault', { kind: 'delay', delayMs: 300, count: 1 });
    const t0 = Date.now();
    assert.equal(await c.s7(readRequest(3, q), 150), null);
    const late = await c.next(1000);
    assert.ok(late && Date.now() - t0 >= 290, `answered after ${Date.now() - t0} ms`);

    await ctl(s, 'POST', '/fault', { kind: 'putget' });
    assert.equal((await ctl(s, 'GET', '/faults')).json.putget, true);
    assert.equal(err(await c.read(q)), 0x8104);
    assert.equal((await ctl(s, 'DELETE', '/fault')).status, 200);
    assert.equal(err(await c.read(q)), 0);

    await ctl(s, 'POST', '/fault', { kind: 'garbage', count: 1 });
    c.sock.write(wrapDt(readRequest(4, q)));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(splitTpkt(c.buf).bad, true);

    const d = await session(s);
    await ctl(s, 'POST', '/fault', { kind: 'close', count: 1 });
    assert.equal(await d.read(q), 'closed');
    const e = await session(s);
    assert.equal(err(await e.read(q)), 0);
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'nonsense' })).status, 400);
    assert.equal((await ctl(s, 'GET', '/counters')).json.faults, 5);
    c.end();
    e.end();
  });

  it('refuse stops listening until DELETE /fault', async () => {
    const s = await boot();
    const c = await session(s);
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'refuse' })).status, 200);
    assert.equal(await c.next(), 'closed');
    await assert.rejects(connect(s), /ECONNREFUSED/);
    await ctl(s, 'DELETE', '/fault');
    await new Promise((r) => setTimeout(r, 50));
    const back = await session(s);
    assert.equal(err(await back.read([DB(2, 0, 2)])), 0);
    back.end();
  });

  it('animates values with the injected clock (bench-500)', async () => {
    let t = 1_791_594_000_000;
    const s = await boot('bench-500.json', { now: () => t });
    const c = await session(s);
    const q = [DB(10, 0, 4), DB(10, 498, 2), DB(10, 500, 8), A('M', 0, 1, 0)];
    let it = items(await c.read(q));
    assert.deepEqual([it[0].data.readInt16BE(0), it[0].data.readInt16BE(2)], [0, 1]);
    assert.equal(it[1].data.readInt16BE(0), 249);
    assert.deepEqual([it[2].data.readFloatBE(0), it[2].data.readFloatBE(4)], [0, 1]);
    t += 3000;
    it = items(await c.read(q));
    assert.deepEqual([it[0].data.readInt16BE(0), it[0].data.readInt16BE(2)], [3, 4]);
    assert.deepEqual([it[2].data.readFloatBE(0), it[2].data.readFloatBE(4)], [3, 4]);
    assert.equal(it[3].rc, 0xff);
    assert.equal((await ctl(s, 'GET', '/mem?area=DB10&byte=0&count=2')).json.hex, '00 03');
    c.end();
  });

  it('counters, log, POST /set, POST /reset and the JSONL log file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 's7-sim-')), 'requests.jsonl');
    const s = await boot('all-types.json', { logFile: file });
    const set = (b) => ctl(s, 'POST', '/set', b);
    assert.equal((await set({ area: 'DB2', byte: 2, type: 'DINT', value: 77 })).status, 200);
    assert.equal(
      (await set({ area: 'DB1', byte: 100, type: 'STRING', maxLength: 4, value: 'ÄÖ' })).status,
      200,
    );
    assert.equal(
      (await set({ area: 'M', byte: 5, bit: 7, type: 'BOOL', value: true })).status,
      200,
    );
    assert.equal((await set({ area: 'DB9', byte: 0, type: 'INT', value: 1 })).status, 400);
    assert.equal((await set({ area: 'DB2', byte: 63, type: 'INT', value: 1 })).status, 400);
    assert.equal((await set({ area: 'DB2', byte: 0, type: 'INT', value: 99999 })).status, 400);
    assert.equal((await ctl(s, 'GET', '/mem?area=DB1&byte=100&count=4')).json.hex, '04 02 C4 D6');
    assert.equal((await ctl(s, 'GET', '/mem?area=M&byte=5&count=1')).json.hex, '80');
    const c = await session(s);
    const it = items(await c.read([DB(2, 2, 4), A('M', 5, 1, 7)]));
    assert.equal(it[0].data.readInt32BE(0), 77);
    assert.equal(hex(it[1].data), '01');
    await c.write([{ ...DB(2, 0, 2), data: Buffer.from([0, 5]) }]);
    const cnt = (await ctl(s, 'GET', '/counters')).json;
    assert.equal(cnt.connections, 1);
    assert.equal(cnt.connectionsOpen, 1);
    assert.equal(cnt.requests, 3);
    assert.equal(cnt.items, 3);
    assert.deepEqual(cnt.byFunction, { setup: 1, read: 1, write: 1 });
    const log = (await ctl(s, 'GET', '/log?since=1')).json.entries;
    assert.deepEqual(
      log.map((e) => [e.seq, e.fn, e.result]),
      [
        [2, 'read', 'ok'],
        [3, 'write', 'ok'],
      ],
    );
    assert.deepEqual(log[1].data, ['0005']);
    assert.equal(typeof log[0].ts, 'number');
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      lines.map((l) => l.fn),
      ['setup', 'read', 'write'],
    );
    assert.equal((await ctl(s, 'POST', '/reset', {})).status, 200);
    assert.equal((await ctl(s, 'GET', '/counters')).json.requests, 0);
    assert.equal((await ctl(s, 'GET', '/mem?area=DB2&byte=0&count=2')).json.hex, '00 05');
    await ctl(s, 'POST', '/reset', { memory: true });
    assert.equal((await ctl(s, 'GET', '/mem?area=DB2&byte=0&count=2')).json.hex, '00 2A');
    assert.equal((await ctl(s, 'GET', '/nothing')).status, 404);
    c.end();
  });

  it('serves several connections at once, each with its own PDU', async () => {
    const s = await boot();
    const a = await session(s, 240);
    const b = await session(s, 480);
    assert.equal(err(await a.read([DB(1, 0, 230)])), 0x8500);
    assert.equal(items(await b.read([DB(1, 0, 230)]))[0].rc, 0xff);
    assert.equal((await ctl(s, 'GET', '/counters')).json.connectionsOpen, 2);
    a.end();
    b.end();
  });

  it('the maps load', () => {
    for (const f of ['all-types.json', 'bench-500.json', 'small-pdu.json']) loadMap(mapJson(f));
    assert.equal(loadMap(mapJson('small-pdu.json')).pduSize, 240);
    assert.ok(loadMap(mapJson('all-types.json')).denied.has('DB3'));
  });
});
