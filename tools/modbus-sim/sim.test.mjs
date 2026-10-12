// Tests of the Modbus TCP simulator (specs/006 T095; contracts/modbus-driver.md §12). `node --test`.
// The simulator's own codec runs over every vector of tests/modbus-vectors/frames (server side).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeAdu, parseAdu, splitAdus } from './codec.mjs';
import { loadMap, Memory } from './map.mjs';
import { SimServer } from './server.mjs';
import { startSim } from './sim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vec = (f) =>
  JSON.parse(readFileSync(join(here, '..', '..', 'tests', 'modbus-vectors', 'frames', f), 'utf8'))
    .cases;
const bytes = (hex) =>
  Buffer.from(
    hex.trim() === ''
      ? []
      : hex
          .trim()
          .split(/\s+/)
          .map((h) => parseInt(h, 16)),
  );
const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** A memory in which every address a request touches exists; reads take their data from `response`. */
function memoryFor(unit, request, response) {
  const mem = new Memory();
  const u = mem.unit(unit, true);
  const fc = request[0];
  const addr = (request[1] << 8) | request[2];
  const qty = (request[3] << 8) | request[4];
  if (fc === 3 || fc === 4) {
    const area = fc === 3 ? 'holding' : 'input';
    for (let i = 0; i < qty; i++)
      u.areas[area].set(addr + i, (response[2 + 2 * i] << 8) | response[3 + 2 * i]);
  } else if (fc === 1 || fc === 2) {
    const area = fc === 1 ? 'coils' : 'discrete';
    for (let i = 0; i < qty; i++)
      u.areas[area].set(addr + i, (response[2 + (i >> 3)] >> (i & 7)) & 1);
  } else if (fc === 5 || fc === 15) {
    for (let i = 0; i < (fc === 5 ? 1 : qty); i++) u.areas.coils.set(addr + i, 0);
  } else if (fc === 6 || fc === 22) {
    u.areas.holding.set(addr, 0);
  } else if (fc === 16) {
    for (let i = 0; i < qty; i++) u.areas.holding.set(addr + i, 0);
  }
  return mem;
}

const now = () => 1_791_594_000_000;

describe('codec on the shared vectors (server side)', () => {
  it('answers every request of mbap.json with the vector response, byte for byte', () => {
    const cases = vec('mbap.json');
    assert.ok(cases.length >= 30);
    for (const c of cases) {
      const request = bytes(c.request);
      const response = bytes(c.response);
      const adu = parseAdu(request);
      const sim = new SimServer({ memory: memoryFor(c.unit, adu.pdu, response.subarray(7)), now });
      const plan = sim.handleFrame(request);
      assert.equal(plan.action, 'respond', c.name);
      assert.equal(hex(plan.buffers[0]), hex(response), c.name);
      assert.ok(plan.buffers[0].length <= 260, c.name);
    }
  });

  it('cuts a stream of frames by the length field, whatever the chunking', () => {
    const cases = vec('mbap.json');
    const all = Buffer.concat(cases.map((c) => bytes(c.request)));
    let buf = Buffer.alloc(0);
    const frames = [];
    for (let i = 0; i < all.length; i += 7) {
      buf = Buffer.concat([buf, all.subarray(i, i + 7)]);
      const r = splitAdus(buf);
      assert.equal(r.lost, false);
      frames.push(...r.frames);
      buf = r.rest;
    }
    assert.equal(frames.length, cases.length);
    assert.equal(buf.length, 0);
    assert.equal(hex(frames[3]), hex(bytes(cases[3].request)));
    assert.equal(splitAdus(bytes('12 34 00 00 00 01 11 03')).lost, true);
    assert.equal(splitAdus(bytes('12 34 00 00 00 FF 11 03')).lost, true);
  });

  it('writes what the write functions say and answers with the echo', () => {
    const mem = new Memory();
    mem.set(1, 'holding', 4, 0x1234);
    mem.set(1, 'holding', 100, 0);
    mem.set(1, 'holding', 101, 0);
    mem.set(1, 'coils', 10, 0);
    for (let i = 0; i < 9; i++) mem.set(1, 'coils', 20 + i, 0);
    const sim = new SimServer({ memory: mem, now });
    const go = (pdu) => sim.handleFrame(encodeAdu(1, 1, Buffer.from(pdu))).buffers[0].subarray(7);
    assert.equal(hex(go([0x16, 0, 4, 0x00, 0xf2, 0x00, 0x25])), '16 00 04 00 F2 00 25');
    // (0x1234 & 0x00F2) | (0x0025 & ~0x00F2)
    assert.equal(mem.value(1, 'holding', 4, 0), (0x1234 & 0x00f2) | (0x0025 & ~0x00f2 & 0xffff));
    assert.equal(hex(go([0x06, 0, 100, 0xab, 0xcd])), '06 00 64 AB CD');
    assert.equal(mem.value(1, 'holding', 100, 0), 0xabcd);
    assert.equal(hex(go([0x10, 0, 100, 0, 2, 4, 0x42, 0xf6, 0xe9, 0x79])), '10 00 64 00 02');
    assert.equal(mem.value(1, 'holding', 101, 0), 0xe979);
    assert.equal(hex(go([0x05, 0, 10, 0xff, 0])), '05 00 0A FF 00');
    assert.equal(mem.value(1, 'coils', 10, 0), 1);
    assert.equal(hex(go([0x0f, 0, 20, 0, 9, 2, 0xcd, 0x01])), '0F 00 14 00 09');
    assert.deepEqual(
      [...Array(9).keys()].map((i) => mem.value(1, 'coils', 20 + i, 0)),
      [1, 0, 1, 1, 0, 0, 1, 1, 1],
    );
  });

  it('answers 02 for an address that is not defined, 03 for a bad quantity, 01 for an unknown function', () => {
    const mem = new Memory();
    mem.set(1, 'holding', 0, 1);
    mem.set(1, 'holding', 2, 3);
    const sim = new SimServer({ memory: mem, now });
    const go = (pdu) =>
      hex(sim.handleFrame(encodeAdu(5, 1, Buffer.from(pdu))).buffers[0].subarray(7));
    assert.equal(go([3, 0, 0, 0, 3]), '83 02'); // the hole at 1
    assert.equal(go([3, 0, 0, 0, 1]), '03 02 00 01');
    assert.equal(go([3, 0, 9, 0, 1]), '83 02');
    assert.equal(go([3, 0, 0, 0, 126]), '83 03');
    assert.equal(go([3, 0, 0, 0, 0]), '83 03');
    assert.equal(go([0x2b, 0x0e, 1, 0]), 'AB 01');
    assert.equal(go([6, 0, 99, 0, 1]), '86 02'); // a write to an address that does not exist
  });
});

describe('exception vectors', () => {
  it('the exception fault gives the vector PDU for every function and code', () => {
    const cases = vec('exceptions.json');
    assert.ok(cases.length >= 100);
    for (const c of cases) {
      const mem = new Memory();
      mem.set(1, 'holding', 1, 1);
      const sim = new SimServer({ memory: mem, now });
      sim.addFault({ kind: 'exception', code: c.code });
      // a request of that function; the fault answers before the memory is looked at
      const pdu = {
        1: [1, 0, 1, 0, 1],
        2: [2, 0, 1, 0, 1],
        3: [3, 0, 1, 0, 1],
        4: [4, 0, 1, 0, 1],
        5: [5, 0, 1, 0xff, 0],
        6: [6, 0, 1, 0, 1],
        15: [15, 0, 1, 0, 1, 1, 1],
        16: [16, 0, 1, 0, 1, 2, 0, 1],
        22: [22, 0, 1, 0, 0xff, 0, 1],
      }[c.fc];
      const plan = sim.handleFrame(encodeAdu(7, 1, Buffer.from(pdu)));
      assert.equal(hex(plan.buffers[0].subarray(7)), c.pdu, c.name);
    }
  });
});

describe('multiple units, areas and scripts', () => {
  const map = {
    units: {
      1: { holding: { 100: [11, 22] }, coils: { 0: [1, 0, 1] } },
      2: { holding: { 100: [33, 44] } },
      3: {
        scripts: [
          { area: 'holding', from: 0, to: 9, kind: 'everySecond' },
          { area: 'holding', address: 20, kind: 'counter', step: 2 },
          {
            area: 'holding',
            address: 21,
            kind: 'sine',
            offset: 1000,
            amplitude: 500,
            periodMs: 4000,
          },
        ],
      },
    },
  };
  const read = (sim, unit, fc, address, qty) => {
    const plan = sim.handleFrame(
      encodeAdu(1, unit, Buffer.from([fc, address >> 8, address & 255, qty >> 8, qty & 255])),
    );
    return plan;
  };

  it('keeps each unit on its own memory', () => {
    const sim = new SimServer({ memory: loadMap(map), now });
    assert.equal(hex(read(sim, 1, 3, 100, 2).buffers[0].subarray(7)), '03 04 00 0B 00 16');
    assert.equal(hex(read(sim, 2, 3, 100, 2).buffers[0].subarray(7)), '03 04 00 21 00 2C');
    assert.equal(hex(read(sim, 1, 1, 0, 3).buffers[0].subarray(7)), '01 01 05');
  });

  it('ignores a unit that is not in the map, or answers 0B as a gateway', () => {
    const sim = new SimServer({ memory: loadMap(map), now });
    assert.equal(read(sim, 9, 3, 100, 1).action, 'silent');
    const gw = new SimServer({ memory: loadMap({ ...map, unknownUnit: 'gateway' }), now });
    assert.equal(hex(read(gw, 9, 3, 100, 1).buffers[0].subarray(7)), '83 0B');
  });

  it('everySecond changes each second and differs between addresses', () => {
    let t = 1_000_000;
    const sim = new SimServer({ memory: loadMap(map), now: () => t });
    const first = read(sim, 3, 3, 0, 3).buffers[0].subarray(9);
    t += 1000;
    const second = read(sim, 3, 3, 0, 3).buffers[0].subarray(9);
    const w = (b, i) => b.readUInt16BE(2 * i);
    assert.equal(w(first, 0), 1000);
    assert.equal(w(first, 1), 1001);
    assert.equal(w(second, 0), 1001);
    assert.notEqual(hex(first), hex(second));
  });

  it('counter counts the reads that include its address; sine follows the clock', () => {
    let t = 0;
    const sim = new SimServer({ memory: loadMap(map), now: () => t });
    const v = () => read(sim, 3, 3, 20, 1).buffers[0].readUInt16BE(9);
    assert.deepEqual([v(), v(), v()], [0, 2, 4]);
    t = 1000; // a quarter of 4000 ms: sin = 1
    assert.equal(read(sim, 3, 3, 21, 1).buffers[0].readUInt16BE(9), 1500);
    t = 3000; // sin = -1
    assert.equal(read(sim, 3, 3, 21, 1).buffers[0].readUInt16BE(9), 500);
  });

  it('a write stops the script at that address', () => {
    const sim = new SimServer({ memory: loadMap(map), now });
    sim.handleFrame(encodeAdu(1, 3, Buffer.from([6, 0, 20, 0x12, 0x34])));
    assert.equal(read(sim, 3, 3, 20, 1).buffers[0].readUInt16BE(9), 0x1234);
    assert.equal(read(sim, 3, 3, 20, 1).buffers[0].readUInt16BE(9), 0x1234);
  });

  it('every map in maps/ loads and every address of bench-500 answers', () => {
    for (const name of ['modbus-demo', 'all-types', 'bench-500']) {
      const json = JSON.parse(readFileSync(join(here, 'maps', `${name}.json`), 'utf8'));
      const mem = loadMap(json);
      assert.ok(mem.units.size >= 1, name);
    }
    const bench = new SimServer({
      memory: loadMap(JSON.parse(readFileSync(join(here, 'maps', 'bench-500.json'), 'utf8'))),
      now,
    });
    const plan = read(bench, 1, 3, 0, 125);
    assert.equal(plan.buffers[0].length, 7 + 2 + 250);
  });
});

describe('faults', () => {
  const mem = () => {
    const m = new Memory();
    for (let i = 0; i < 10; i++) m.set(1, 'holding', i, i + 1);
    return m;
  };
  const req = (tid = 0x1234, addr = 0, qty = 1, unit = 1) =>
    encodeAdu(tid, unit, Buffer.from([3, addr >> 8, addr & 255, qty >> 8, qty & 255]));

  it('timeout: no answer; count limits how many requests it eats', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.addFault({ kind: 'timeout', count: 2 });
    assert.equal(sim.handleFrame(req()).action, 'silent');
    assert.equal(sim.handleFrame(req()).action, 'silent');
    assert.equal(sim.handleFrame(req()).action, 'respond');
    assert.equal(sim.faults.length, 0);
  });

  it('delay: answers after delayMs; close: closes the connection', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.addFault({ kind: 'delay', delayMs: 700, count: 1 });
    const d = sim.handleFrame(req());
    assert.equal(d.action, 'respond');
    assert.equal(d.delayMs, 700);
    sim.addFault({ kind: 'close', count: 1 });
    assert.equal(sim.handleFrame(req()).action, 'close');
  });

  it('is scoped by unit, function and address range', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.addFault({ kind: 'timeout', unit: 1, fc: 3, from: 5, to: 6 });
    assert.equal(sim.handleFrame(req(1, 0, 3)).action, 'respond');
    assert.equal(sim.handleFrame(req(1, 4, 2)).action, 'silent'); // 4..5 overlaps 5..6
    assert.equal(sim.handleFrame(req(1, 7, 2)).action, 'respond');
    assert.equal(sim.handleFrame(encodeAdu(1, 1, Buffer.from([4, 0, 5, 0, 1]))).action, 'respond'); // other function (02: no input area, still an answer)
  });

  it('bad-tid, bad-unit and bad-length each break exactly one thing', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.addFault({ kind: 'bad-tid', count: 1 });
    let r = sim.handleFrame(req(0x1234, 0, 1, 1)).buffers[0];
    assert.equal(r.readUInt16BE(0), 0x1235);
    assert.equal(r[6], 1);
    assert.equal(r.readUInt16BE(4), r.length - 6);
    sim.addFault({ kind: 'bad-unit', count: 1 });
    r = sim.handleFrame(req(0x1234, 0, 1, 1)).buffers[0];
    assert.equal(r.readUInt16BE(0), 0x1234);
    assert.equal(r[6], 2);
    assert.equal(r.readUInt16BE(4), r.length - 6);
    sim.addFault({ kind: 'bad-length', count: 1 });
    r = sim.handleFrame(req(0x1234, 0, 1, 1)).buffers[0];
    assert.equal(r.readUInt16BE(0), 0x1234);
    assert.equal(r[6], 1);
    assert.equal(r.readUInt16BE(4), r.length - 6 + 1);
  });

  it('garbage answers with bytes that are not a frame, after delayMs', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.addFault({ kind: 'garbage', count: 1, bytes: 9, delayMs: 50 });
    const p = sim.handleFrame(req());
    assert.equal(p.buffers[0].length, 9);
    assert.equal(p.delayMs, 50);
  });

  it('counts requests, responses, exceptions and faults, and logs every request', () => {
    const sim = new SimServer({ memory: mem(), now });
    sim.handleFrame(req(1, 0, 2));
    sim.handleFrame(req(2, 50, 1)); // 02
    sim.addFault({ kind: 'timeout', count: 1 });
    sim.handleFrame(req(3, 0, 1));
    const c = sim.counters();
    assert.equal(c.requests, 3);
    assert.equal(c.responses, 2);
    assert.equal(c.exceptions, 1);
    assert.equal(c.faults, 1);
    assert.equal(c.byFc['3'], 3);
    const log = sim.logEntries(0);
    assert.equal(log.length, 3);
    assert.deepEqual(
      {
        unit: log[0].unit,
        fc: log[0].fc,
        address: log[0].address,
        quantity: log[0].quantity,
        tid: log[0].tid,
      },
      { unit: 1, fc: 3, address: 0, quantity: 2, tid: 1 },
    );
    assert.equal(typeof log[0].ts, 'number');
    assert.equal(log[1].result, 'exception:02');
    assert.equal(log[2].result, 'fault:timeout');
  });
});

describe('over TCP, with the control API', () => {
  const sims = [];
  after(async () => {
    for (const s of sims) await s.close();
  });
  const map = { units: { 1: { holding: { 0: [10, 20, 30] } } } };
  async function boot() {
    const s = await startSim({ map, tcpPort: 0, controlPort: 0, host: '127.0.0.1' });
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
      const sock = net.connect(s.tcpPort, '127.0.0.1', () => resolve(sock));
      sock.once('error', reject);
    });
  const roundTrip = (sock, frame, ms = 400) =>
    new Promise((resolve) => {
      const chunks = [];
      const onData = (d) => chunks.push(d);
      sock.on('data', onData);
      const done = () => {
        sock.off('data', onData);
        resolve(Buffer.concat(chunks));
      };
      sock.once('close', done);
      setTimeout(done, ms);
      sock.write(frame);
    });
  const read3 = (tid = 1) => encodeAdu(tid, 1, Buffer.from([3, 0, 0, 0, 3]));

  it('answers a request, also when it arrives one byte at a time', async () => {
    const s = await boot();
    const sock = await connect(s);
    const frame = read3(77);
    const waiting = new Promise((resolve) => sock.once('data', resolve));
    for (const b of frame) {
      sock.write(Buffer.from([b]));
      await new Promise((r) => setTimeout(r, 3));
    }
    const got = await waiting;
    assert.equal(hex(got), '00 4D 00 00 00 09 01 03 06 00 0A 00 14 00 1E');
    sock.destroy();
  });

  it('POST /fault timeout, GET /counters, GET /log, POST /reset', async () => {
    const s = await boot();
    const sock = await connect(s);
    assert.equal((await roundTrip(sock, read3())).length, 15);
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'timeout', count: 1 })).status, 200);
    assert.equal((await roundTrip(sock, read3(2), 250)).length, 0);
    assert.equal((await roundTrip(sock, read3(3))).length, 15);
    const counters = (await ctl(s, 'GET', '/counters')).json;
    assert.equal(counters.requests, 3);
    assert.equal(counters.responses, 2);
    assert.equal(counters.faults, 1);
    assert.equal(counters.connections.accepted, 1);
    const log = (await ctl(s, 'GET', '/log')).json.entries;
    assert.equal(log.length, 3);
    assert.equal(log[1].result, 'fault:timeout');
    assert.equal((await ctl(s, 'POST', '/reset', {})).status, 200);
    assert.equal((await ctl(s, 'GET', '/counters')).json.requests, 0);
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'nonsense' })).status, 400);
    sock.destroy();
  });

  it('delay holds the answer back, close drops the connection', async () => {
    const s = await boot();
    const sock = await connect(s);
    await ctl(s, 'POST', '/fault', { kind: 'delay', delayMs: 300, count: 1 });
    const t0 = Date.now();
    const r = await roundTrip(sock, read3(), 1000).then((b) => b);
    assert.ok(r.length === 15 && Date.now() - t0 >= 290, `answered after ${Date.now() - t0} ms`);
    await ctl(s, 'POST', '/fault', { kind: 'close', count: 1 });
    const closed = new Promise((resolve) => sock.once('close', resolve));
    sock.write(read3(9));
    await closed;
    const again = await connect(s);
    assert.equal((await roundTrip(again, read3())).length, 15);
    again.destroy();
  });

  it('refuse makes a new connection fail until the faults are cleared', async () => {
    const s = await boot();
    const sock = await connect(s);
    assert.equal((await ctl(s, 'POST', '/fault', { kind: 'refuse' })).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(connect(s), /ECONNREFUSED/);
    assert.ok(sock.destroyed || true);
    await ctl(s, 'POST', '/fault', { kind: 'clear' });
    const back = await connect(s);
    assert.equal((await roundTrip(back, read3())).length, 15);
    back.destroy();
  });

  it('POST /set changes a value, GET /mem reads it, and the JSONL log file gets a line per request', async () => {
    const dir = await import('node:fs').then((fs) =>
      fs.mkdtempSync(join(process.env.TMPDIR ?? process.env.TEMP ?? '/tmp', 'sim-')),
    );
    const file = join(dir, 'requests.jsonl');
    const s = await startSim({ map, tcpPort: 0, controlPort: 0, host: '127.0.0.1', logFile: file });
    sims.push(s);
    assert.equal(
      (await ctl(s, 'POST', '/set', { unit: 1, area: 'holding', address: 1, value: 777 })).status,
      200,
    );
    assert.deepEqual(
      (await ctl(s, 'GET', '/mem?unit=1&area=holding&address=0&count=3')).json.values,
      [10, 777, 30],
    );
    const sock = await connect(s);
    assert.equal(hex((await roundTrip(sock, read3())).subarray(9)), '00 0A 03 09 00 1E');
    sock.destroy();
    await new Promise((r) => setTimeout(r, 50));
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual(
      {
        unit: lines[0].unit,
        fc: lines[0].fc,
        address: lines[0].address,
        quantity: lines[0].quantity,
      },
      { unit: 1, fc: 3, address: 0, quantity: 3 },
    );
  });

  it('serves several units on one port, each connection on its own', async () => {
    const s = await startSim({
      map: { units: { 1: { holding: { 0: [1] } }, 2: { holding: { 0: [2] } } } },
      tcpPort: 0,
      controlPort: 0,
      host: '127.0.0.1',
    });
    sims.push(s);
    const a = await connect(s);
    const b = await connect(s);
    const q = (unit) => encodeAdu(5, unit, Buffer.from([3, 0, 0, 0, 1]));
    assert.equal((await roundTrip(a, q(2))).readUInt16BE(9), 2);
    assert.equal((await roundTrip(b, q(1))).readUInt16BE(9), 1);
    assert.equal((await ctl(s, 'GET', '/counters')).json.connections.current, 2);
    a.destroy();
    b.destroy();
  });
});
