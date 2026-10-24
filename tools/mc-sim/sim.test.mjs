// Tests of the MC protocol simulator (specs/017-driver-mc, contracts/mc-protocol.md §5). `node --test`.
// The simulator answers every request of tests/mc-vectors/frames.json with the vector response.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeResponse, hex4, parseFrame, splitFrames } from './codec.mjs';
import { DEVICES, decodeTyped, encodeTyped, loadMap } from './map.mjs';
import { SimServer } from './server.mjs';
import { startSim } from './sim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(join(here, '..', '..', 'tests', 'mc-vectors', 'frames.json'), 'utf8'),
).cases;
const bytes = (h) =>
  Buffer.from(
    h
      .trim()
      .split(/\s+/)
      .map((x) => parseInt(x, 16)),
  );
const hex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const wire = (c, w) => (c.options.code === 'ascii' ? Buffer.from(w, 'latin1') : bytes(w));
const show = (c, b) => (c.options.code === 'ascii' ? b.toString('latin1') : hex(b));
const now = () => 1_791_594_000_000;

const ALL_DEVICES = Object.fromEntries(
  Object.keys(DEVICES).map((n) => [n, { size: n === 'ZR' ? 1048576 : 65536 }]),
);

function memoryFor(c, devices = ALL_DEVICES) {
  const o = c.options;
  return loadMap({
    xyNotation: o.xyOctal ? 'octal' : 'hex',
    routes: [
      {
        network: o.network,
        station: o.station,
        moduleIo: o.moduleIo,
        moduleStation: o.moduleStation,
      },
    ],
    devices,
  });
}

/** Puts in memory the values that the expected response of a read carries. */
function seed(mem, req, expect) {
  const step = (d) => (DEVICES[d].bit ? 16 : 1);
  if (req.cmd === 'batchReadWords')
    expect.words.forEach((w, i) => mem.setWord(req.device, req.number + i * step(req.device), w));
  if (req.cmd === 'batchReadBits')
    expect.bits.forEach((b, i) => mem.set(req.device, req.number + i, b));
  if (req.cmd === 'randomRead') {
    const n = req.randomWords.length;
    req.randomWords.forEach((p, i) => mem.setWord(p.device, p.number, expect.words[i]));
    req.randomDwords.forEach((p, j) => {
      mem.setWord(p.device, p.number, expect.words[n + 2 * j]);
      mem.setWord(p.device, p.number + step(p.device), expect.words[n + 2 * j + 1]);
    });
  }
}

// ---- request builders -------------------------------------------------------------------------

const ROUTE = { network: 0, station: 255, moduleIo: 0x3ff, moduleStation: 0 };

function binReq({ frame = '3E', serial = 0x1234, route = ROUTE, cmd, sub, data = [] }) {
  const body = Buffer.concat([
    Buffer.from([0x10, 0, cmd & 0xff, cmd >> 8, sub & 0xff, sub >> 8]),
    Buffer.from(data),
  ]);
  const head = Buffer.alloc(9);
  head[0] = 0x50;
  head[2] = route.network;
  head[3] = route.station;
  head.writeUInt16LE(route.moduleIo, 4);
  head[6] = route.moduleStation;
  head.writeUInt16LE(body.length, 7);
  if (frame === '4E') {
    head[0] = 0x54;
    const s = Buffer.from([0, 0, serial & 0xff, serial >> 8, 0, 0]);
    s[0] = 0x54;
    return Buffer.concat([s, head.subarray(2), body]);
  }
  return Buffer.concat([head, body]);
}

const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

function asciiReq({ frame = '3E', serial = 0xab, route = ROUTE, cmd, sub, data = '' }) {
  const body = '0010' + hex4(cmd) + hex4(sub) + data;
  const r = h2(route.network) + h2(route.station) + hex4(route.moduleIo) + h2(route.moduleStation);
  const head = frame === '4E' ? '5400' + hex4(serial) + '0000' : '5000';
  return Buffer.from(head + r + hex4(body.length) + body, 'latin1');
}

const dev = (name, at) => [at & 0xff, (at >> 8) & 0xff, (at >> 16) & 0xff, DEVICES[name].code];
const u16 = (n) => [n & 0xff, n >> 8];

/** End code and data of a response frame (header parsed with the request codec's help). */
function reply(buf) {
  if (buf[0] === 0xd0 || buf[0] === 0xd4) {
    const o = buf[0] === 0xd4 ? 4 : 0;
    assert.equal(buf.readUInt16LE(7 + o), buf.length - 9 - o, 'length field');
    return { endCode: buf.readUInt16LE(9 + o), data: buf.subarray(11 + o) };
  }
  const t = buf.toString('latin1');
  const o = t.startsWith('D400') ? 8 : 0;
  assert.equal(parseInt(t.slice(14 + o, 18 + o), 16), t.length - 18 - o, 'length field');
  return { endCode: parseInt(t.slice(18 + o, 22 + o), 16), data: t.slice(22 + o) };
}

function simWith(json) {
  return new SimServer({ memory: loadMap(json), now, rand: () => 0.5 });
}
const ask = (sim, frame) => {
  const plan = sim.handleFrame(frame);
  return plan.action === 'respond' ? reply(plan.buffers[0]) : null;
};

const BASIC = {
  devices: {
    D: { size: 2000 },
    W: { size: 512 },
    ZR: { size: 70000 },
    M: { size: 2048 },
    X: { size: 1024 },
    Y: { size: 1024 },
    TN: { size: 100 },
  },
};

// ---- the shared vectors -----------------------------------------------------------------------

describe('frames.json vectors (server side)', () => {
  it('answers every request with the success response, byte for byte', () => {
    let checked = 0;
    for (const c of CASES) {
      const resp = c.responses.find((r) => r.expect.issue === 'none' && r.expect.endCode === 0);
      assert.ok(resp, c.name);
      const mem = memoryFor(c);
      seed(mem, c.request, resp.expect);
      const sim = new SimServer({ memory: mem, now });
      const req = wire(c, c.wire);
      const plan = sim.handleFrame(req);
      assert.equal(plan.action, 'respond', c.name);
      assert.equal(show(c, plan.buffers[0]), show(c, wire(c, resp.wire)), c.name);
      if (c.request.cmd === 'batchWriteWords') {
        const step = DEVICES[c.request.device].bit ? 16 : 1;
        c.request.words.forEach((w, i) =>
          assert.equal(mem.getWord(c.request.device, c.request.number + i * step), w, c.name),
        );
      }
      if (c.request.cmd === 'batchWriteBits')
        c.request.bits.forEach((b, i) =>
          assert.equal(mem.get(c.request.device, c.request.number + i), b, c.name),
        );
      checked++;
    }
    assert.equal(checked, CASES.length);
  });

  it('gives the vector error responses (end code fault, C056 from a short device)', () => {
    let checked = 0;
    for (const c of CASES)
      for (const resp of c.responses) {
        if (resp.expect.issue !== 'none' || resp.expect.endCode === 0) continue;
        const sim = new SimServer({ memory: memoryFor(c), now });
        sim.addFault({ mode: 'endcode', code: resp.expect.endCode });
        assert.equal(
          show(c, sim.handleFrame(wire(c, c.wire)).buffers[0]),
          show(c, wire(c, resp.wire)),
        );
        checked++;
        if (resp.expect.endCode === 0xc056) {
          // the same answer with no fault: D has 102 points, the request wants D100..D102
          const short = new SimServer({
            memory: memoryFor(c, { D: { size: 102 } }),
            now,
          });
          const out = short.handleFrame(wire(c, c.wire)).buffers[0];
          assert.equal(show(c, out), show(c, wire(c, resp.wire)), c.name);
        }
      }
    assert.ok(checked >= 3);
  });

  it('cuts a stream of every vector request, whatever the chunking', () => {
    const all = Buffer.concat(CASES.map((c) => wire(c, c.wire)));
    for (const chunk of [1, 5, 13, all.length]) {
      let buf = Buffer.alloc(0);
      const frames = [];
      for (let i = 0; i < all.length; i += chunk) {
        buf = Buffer.concat([buf, all.subarray(i, i + chunk)]);
        const r = splitFrames(buf);
        assert.equal(r.lost, false);
        frames.push(...r.frames);
        buf = r.rest;
      }
      assert.equal(frames.length, CASES.length);
      assert.equal(buf.length, 0);
      frames.forEach((f, i) =>
        assert.equal(f.toString('latin1'), wire(CASES[i], CASES[i].wire).toString('latin1')),
      );
    }
    assert.equal(splitFrames(bytes('51 00 00')).lost, true);
    assert.equal(splitFrames(Buffer.from('5001')).lost, true);
    assert.equal(splitFrames(Buffer.from('HELLO')).lost, true);
    assert.equal(splitFrames(bytes('50 00 00 FF FF 03 00 02 00')).lost, true); // length < 6
    assert.equal(splitFrames(Buffer.from('500000FF03FF00ZZZZ')).lost, true);
    assert.equal(splitFrames(Buffer.from('54')).frames.length, 0);
    assert.equal(splitFrames(Buffer.from('54')).lost, false);
  });
});

// ---- commands ---------------------------------------------------------------------------------

describe('commands', () => {
  it('0401/0000 reads words of a word device and 16 points per word of a bit device', () => {
    const sim = simWith({
      devices: {
        D: { size: 100, values: [{ at: 10, words: [1, 0xbeef, 3] }] },
        M: { size: 64, on: [16, 31, 32] },
      },
    });
    const r = ask(sim, binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 10), ...u16(3)] }));
    assert.equal(r.endCode, 0);
    assert.equal(hex(r.data), '01 00 EF BE 03 00');
    const b = ask(sim, binReq({ cmd: 0x0401, sub: 0, data: [...dev('M', 16), ...u16(2)] }));
    assert.equal(hex(b.data), '01 80 01 00');
    const a = ask(sim, asciiReq({ cmd: 0x0401, sub: 0, data: 'M*0000160002' }));
    assert.equal(a.data, '80010001');
  });

  it('0401/0001 reads points, first point in the high nibble (binary), one char each (ASCII)', () => {
    const sim = simWith({ devices: { M: { size: 64, on: [0, 3, 4] }, D: { size: 10 } } });
    const r = ask(sim, binReq({ cmd: 0x0401, sub: 1, data: [...dev('M', 0), ...u16(5)] }));
    assert.equal(hex(r.data), '10 01 10');
    assert.equal(ask(sim, asciiReq({ cmd: 0x0401, sub: 1, data: 'M*0000000005' })).data, '10011');
    // bit units on a word device: C05B
    assert.equal(
      ask(sim, binReq({ cmd: 0x0401, sub: 1, data: [...dev('D', 0), ...u16(1)] })).endCode,
      0xc05b,
    );
  });

  it('1401/0000 and 1401/0001 write words and points, both codes, both device kinds', () => {
    const sim = simWith({ devices: { D: { size: 100 }, M: { size: 64 }, W: { size: 0x200 } } });
    const mem = sim.memory;
    let r = ask(
      sim,
      binReq({ cmd: 0x1401, sub: 0, data: [...dev('D', 5), ...u16(2), 1, 2, 3, 4] }),
    );
    assert.equal(r.endCode, 0);
    assert.equal(r.data.length, 0);
    assert.deepEqual([mem.get('D', 5), mem.get('D', 6)], [0x0201, 0x0403]);
    ask(sim, binReq({ cmd: 0x1401, sub: 0, data: [...dev('M', 16), ...u16(1), 0x05, 0x80] }));
    assert.deepEqual(
      [16, 17, 18, 31].map((i) => mem.get('M', i)),
      [1, 0, 1, 1],
    );
    ask(sim, binReq({ cmd: 0x1401, sub: 1, data: [...dev('M', 40), ...u16(3), 0x01, 0x10] }));
    assert.deepEqual(
      [40, 41, 42].map((i) => mem.get('M', i)),
      [0, 1, 1],
    );
    r = ask(sim, asciiReq({ cmd: 0x1401, sub: 0, data: 'W*0001000002ABCD0001' }));
    assert.equal(r.endCode, 0);
    assert.deepEqual([mem.get('W', 0x100), mem.get('W', 0x101)], [0xabcd, 1]);
    ask(sim, asciiReq({ cmd: 0x1401, sub: 1, data: 'M*0000500002' + '11' }));
    assert.deepEqual([mem.get('M', 50), mem.get('M', 51)], [1, 1]);
    assert.equal(
      ask(sim, binReq({ cmd: 0x1401, sub: 1, data: [...dev('D', 0), ...u16(1), 0x10] })).endCode,
      0xc05b,
    );
  });

  it('0403 reads words then dwords, low word at the lower number, bit devices 16/32 points', () => {
    const sim = simWith({
      devices: {
        D: { size: 100, values: [{ at: 0, words: [0x1111, 0x2222, 0x3333] }] },
        Y: { size: 64, on: [0, 17, 32] },
      },
    });
    const data = [2, 2, ...dev('D', 2), ...dev('Y', 0), ...dev('D', 0), ...dev('Y', 16)];
    const r = ask(sim, binReq({ cmd: 0x0403, sub: 0, data }));
    assert.equal(r.endCode, 0);
    assert.equal(hex(r.data), '33 33 01 00 11 11 22 22 02 00 01 00');
    const a = ask(sim, asciiReq({ cmd: 0x0403, sub: 0, data: '0101D*000002D*000000' }));
    assert.equal(a.data, '3333' + '22221111');
    const e = ask(sim, asciiReq({ frame: '4E', cmd: 0x0403, sub: 0, data: '0100D*000099' }));
    assert.equal(e.data, '0000');
  });

  it('4E echoes the serial, binary and ASCII', () => {
    const sim = simWith(BASIC);
    sim.memory.set('D', 7, 42);
    const b = sim.handleFrame(
      binReq({ frame: '4E', serial: 0xbeef, cmd: 0x0401, sub: 0, data: [...dev('D', 7), 1, 0] }),
    ).buffers[0];
    assert.equal(hex(b), 'D4 00 EF BE 00 00 00 FF FF 03 00 04 00 00 00 2A 00');
    const a = sim.handleFrame(
      asciiReq({ frame: '4E', serial: 0x1f, cmd: 0x0401, sub: 0, data: 'D*0000070001' }),
    ).buffers[0];
    assert.equal(a.toString(), 'D400001F000000FF03FF0000080000002A');
  });
});

// ---- limits and end codes ---------------------------------------------------------------------

describe('limits and end codes', () => {
  const sim = simWith(BASIC);
  const code = (frame) => ask(sim, frame).endCode;
  const read = (name, at, n, sub = 0) =>
    code(binReq({ cmd: 0x0401, sub, data: [...dev(name, at), ...u16(n)] }));

  it('C051 for a point count beyond 960 words / 7168 bits / 192 random points, or 0', () => {
    assert.equal(read('D', 0, 960), 0);
    assert.equal(read('D', 0, 961), 0xc051);
    assert.equal(read('D', 0, 0), 0xc051);
    assert.equal(read('ZR', 0, 960), 0);
    assert.equal(read('M', 0, 2048, 1), 0);
    assert.equal(read('M', 0, 7169, 1), 0xc051);
    const big = new SimServer({ memory: loadMap({ devices: { M: { size: 8192 } } }), now });
    assert.equal(
      ask(big, binReq({ cmd: 0x0401, sub: 1, data: [...dev('M', 0), ...u16(7168)] })).endCode,
      0,
    );
    const rnd = (n, m) => {
      const pts = [];
      for (let i = 0; i < n + m; i++) pts.push(...dev('D', i));
      return code(binReq({ cmd: 0x0403, sub: 0, data: [n, m, ...pts] }));
    };
    assert.equal(rnd(100, 92), 0);
    assert.equal(rnd(100, 93), 0xc051);
    assert.equal(rnd(0, 0), 0xc051);
    assert.equal(code(asciiReq({ cmd: 0x0401, sub: 0, data: 'D*0000000000' })), 0xc051);
  });

  it('C056 beyond the device size (words, points, words of bits, random)', () => {
    assert.equal(read('D', 1999, 1), 0);
    assert.equal(read('D', 1999, 2), 0xc056);
    assert.equal(read('M', 2032, 1), 0);
    assert.equal(read('M', 2040, 1), 0xc056); // 16 points from M2040
    assert.equal(read('M', 2047, 1, 1), 0);
    assert.equal(read('M', 2047, 2, 1), 0xc056);
    assert.equal(read('D', 0xffffff, 1), 0xc056);
    assert.equal(code(binReq({ cmd: 0x0403, sub: 0, data: [0, 1, ...dev('D', 1999)] })), 0xc056);
    assert.equal(code(asciiReq({ cmd: 0x1401, sub: 0, data: 'D*0019990002AAAABBBB' })), 0xc056);
  });

  it('C059 unknown command or subcommand, C05C device not in the map, C061 bad data length', () => {
    assert.equal(code(binReq({ cmd: 0x0801, sub: 0 })), 0xc059);
    assert.equal(code(binReq({ cmd: 0x0401, sub: 2, data: [...dev('D', 0), 1, 0] })), 0xc059);
    assert.equal(code(binReq({ cmd: 0x0403, sub: 1, data: [1, 0, ...dev('D', 0)] })), 0xc059);
    assert.equal(read('R', 0, 1), 0xc05c); // a device of the contract that the map lacks
    assert.equal(code(binReq({ cmd: 0x0401, sub: 0, data: [0, 0, 0, 0x01, 1, 0] })), 0xc05c);
    assert.equal(code(asciiReq({ cmd: 0x0401, sub: 0, data: 'QQ0000000001' })), 0xc05c);
    assert.equal(code(binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 0), 1, 0, 0] })), 0xc061);
    assert.equal(code(binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 0)] })), 0xc061);
    assert.equal(code(binReq({ cmd: 0x1401, sub: 0, data: [...dev('D', 0), 2, 0, 1, 0] })), 0xc061);
    assert.equal(code(asciiReq({ cmd: 0x0401, sub: 0, data: 'D*00000G0001' })), 0xc050);
  });

  it('an error response carries the 9-byte / 18-char error information of the request', () => {
    const route = { network: 0, station: 255, moduleIo: 0x3ff, moduleStation: 0 };
    const b = sim.handleFrame(binReq({ route, cmd: 0x0401, sub: 2, data: [] })).buffers[0];
    assert.equal(hex(b), 'D0 00 00 FF FF 03 00 0B 00 59 C0 00 FF FF 03 00 01 04 02 00');
    const a = sim.handleFrame(asciiReq({ cmd: 0x1401, sub: 3 })).buffers[0];
    assert.equal(a.toString(), 'D00000FF03FF000016C05900FF03FF0014010003');
  });
});

// ---- routes, ASCII notation, map --------------------------------------------------------------

describe('routes and notation', () => {
  it('answers only the routes of the map (default 0/255), logs the others', () => {
    const def = simWith(BASIC);
    const other = { network: 1, station: 2, moduleIo: 0x3ff, moduleStation: 0 };
    const req = { cmd: 0x0401, sub: 0, data: [...dev('D', 0), 1, 0] };
    assert.equal(def.handleFrame(binReq(req)).action, 'respond');
    assert.equal(def.handleFrame(binReq({ ...req, route: other })).action, 'silent');
    assert.equal(def.logEntries().at(-1).result, 'route');
    assert.equal(def.counters().unanswered, 1);
    const routed = simWith({ ...BASIC, routes: [{ network: 1, station: 2, moduleIo: 0x3e0 }] });
    assert.equal(routed.handleFrame(binReq(req)).action, 'silent');
    assert.equal(routed.handleFrame(binReq({ ...req, route: other })).action, 'silent');
    const ok = routed.handleFrame(
      binReq({ ...req, route: { ...other, moduleIo: 0x3e0, moduleStation: 7 } }),
    );
    assert.equal(hex(ok.buffers[0].subarray(0, 7)), 'D0 00 01 02 E0 03 07');
  });

  it('ASCII X/Y numbers are hex, or octal when the map says so; B, W, ZR hex; others decimal', () => {
    const hexSim = simWith({
      devices: { X: { size: 1024, on: [0x1a0] }, B: { size: 512, on: [0x1f] } },
    });
    assert.equal(ask(hexSim, asciiReq({ cmd: 0x0401, sub: 1, data: 'X*0001A00001' })).data, '1');
    assert.equal(ask(hexSim, asciiReq({ cmd: 0x0401, sub: 1, data: 'B*00001F0001' })).data, '1');
    const oct = simWith({
      xyNotation: 'octal',
      devices: { X: { size: 64, on: ['17'] }, Y: { size: 64 } },
    });
    assert.equal(oct.memory.get('X', 15), 1);
    assert.equal(ask(oct, asciiReq({ cmd: 0x0401, sub: 1, data: 'X*0000170001' })).data, '1');
    assert.equal(ask(oct, asciiReq({ cmd: 0x0401, sub: 1, data: 'X*0000180001' })).endCode, 0xc050);
    ask(oct, asciiReq({ cmd: 0x1401, sub: 1, data: 'Y*0000200001' + '1' }));
    assert.equal(oct.memory.get('Y', 16), 1);
    // binary carries the plain number whatever the notation
    assert.equal(
      hex(ask(oct, binReq({ cmd: 0x0401, sub: 1, data: [...dev('X', 15), 1, 0] })).data),
      '10',
    );
  });

  it('loads every type with the Mitsubishi word layout', () => {
    const mem = loadMap({
      devices: {
        D: {
          size: 100,
          values: [
            { at: 0, type: 'INT16', value: -2 },
            { at: 1, type: 'UINT16', value: 65535 },
            { at: 2, type: 'INT32', value: -100000 },
            { at: 4, type: 'UINT32', value: 4000000000 },
            { at: 6, type: 'FLOAT32', value: 1.5 },
            { at: 8, type: 'FLOAT64', value: -2.25 },
            { at: 12, type: 'INT64', value: '-1234567890123' },
            { at: 16, type: 'UINT64', value: '18446744073709551615' },
            { at: 20, type: 'STRING', value: 'ABC', length: 6 },
          ],
          bits: [
            { at: 30, bit: 5, value: true },
            { at: 30, bit: 15, value: true },
          ],
        },
        W: { size: 0x200, values: [{ at: '1FF', type: 'UINT16', value: 7 }] },
        ZR: { size: 1048576, values: [{ at: 1048575, type: 'INT16', value: 1 }] },
      },
    });
    const w = (from, n) => [...Array(n).keys()].map((i) => mem.get('D', from + i));
    assert.deepEqual(w(0, 2), [0xfffe, 0xffff]);
    assert.deepEqual(w(2, 2), [(-100000 & 0xffff) >>> 0, 0xfffe]);
    assert.deepEqual(w(4, 2), [4000000000 & 0xffff, Math.floor(4000000000 / 65536)]);
    assert.deepEqual(w(6, 2), [0x0000, 0x3fc0]);
    assert.deepEqual(w(8, 4), [0, 0, 0, 0xc002]);
    assert.deepEqual(w(16, 4), [0xffff, 0xffff, 0xffff, 0xffff]);
    assert.equal(mem.getTyped('D', 12, 'INT64'), '-1234567890123');
    assert.deepEqual(w(20, 3), [0x4241, 0x0043, 0]);
    assert.equal(mem.getTyped('D', 20, 'STRING', 6), 'ABC');
    assert.equal(mem.get('D', 30), 0x8020);
    assert.equal(mem.get('W', 0x1ff), 7);
    assert.equal(mem.get('ZR', 1048575), 1);
    for (const t of ['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'FLOAT64'])
      assert.equal(decodeTyped(t, encodeTyped(t, 3)), 3, t);
    assert.throws(() => loadMap({ devices: { D: { size: 2_000_000 } } }), /size/);
    assert.throws(() => loadMap({ devices: { Q: {} } }), /unknown device/);
    assert.throws(
      () => loadMap({ devices: { D: { size: 4, values: [{ at: 3, type: 'INT32', value: 1 }] } } }),
      /range/,
    );
  });

  it('loads the maps of the repository', () => {
    for (const f of ['all-types.json', 'bench-500.json']) {
      const mem = loadMap(JSON.parse(readFileSync(join(here, 'maps', f), 'utf8')));
      assert.ok(mem.devices.size >= 2, f);
    }
    const all = loadMap(JSON.parse(readFileSync(join(here, 'maps', 'all-types.json'), 'utf8')));
    for (const name of Object.keys(DEVICES)) assert.ok(all.device(name), name);
  });

  it('everySecond FLOAT32 scripts hold a finite float per word pair', () => {
    let t = 5000;
    const mem = loadMap({
      devices: { D: { size: 10 } },
      scripts: [{ device: 'D', from: 2, to: 7, kind: 'everySecond', type: 'FLOAT32' }],
    });
    assert.equal(mem.getTyped('D', 2, 'FLOAT32', undefined, t), 5);
    assert.equal(mem.getTyped('D', 6, 'FLOAT32', undefined, t), 7);
    t = 6000;
    assert.equal(mem.getTyped('D', 4, 'FLOAT32', undefined, t), 7);
    assert.throws(
      () =>
        loadMap({
          devices: { M: {} },
          scripts: [{ device: 'M', from: 0, to: 1, type: 'FLOAT32' }],
        }),
      /FLOAT32/,
    );
  });

  it('everySecond scripts change each second until a write', () => {
    let t = 5000;
    const sim = new SimServer({
      memory: loadMap({
        devices: { D: { size: 10 } },
        scripts: [{ device: 'D', from: 0, to: 9, kind: 'everySecond' }],
      }),
      now: () => t,
    });
    const rd = () => ask(sim, binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 0), 2, 0] })).data;
    assert.equal(hex(rd()), '05 00 06 00');
    t = 6000;
    assert.equal(hex(rd()), '06 00 07 00');
    ask(sim, binReq({ cmd: 0x1401, sub: 0, data: [...dev('D', 0), 1, 0, 9, 0] }));
    assert.equal(hex(rd()), '09 00 07 00');
  });
});

// ---- faults -----------------------------------------------------------------------------------

describe('faults (model)', () => {
  const rd = (at, n = 1) => binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', at), ...u16(n)] });

  it('silent, endcode on a device range, count, delay, garbage, clear', () => {
    const sim = simWith(BASIC);
    sim.addFault({ mode: 'silent', count: 1 });
    assert.equal(sim.handleFrame(rd(0)).action, 'silent');
    assert.equal(sim.handleFrame(rd(0)).action, 'respond');
    sim.addFault({ mode: 'endcode', code: 'C05B', device: 'D', from: 100, to: 199 });
    assert.equal(ask(sim, rd(0)).endCode, 0);
    assert.equal(ask(sim, rd(90, 11)).endCode, 0xc05b);
    assert.equal(ask(sim, rd(199)).endCode, 0xc05b);
    assert.equal(ask(sim, rd(200)).endCode, 0);
    assert.equal(
      ask(sim, binReq({ cmd: 0x0401, sub: 0, data: [...dev('W', 150), 1, 0] })).endCode,
      0,
    );
    // random read: a point inside the range
    assert.equal(
      ask(sim, binReq({ cmd: 0x0403, sub: 0, data: [2, 0, ...dev('W', 0), ...dev('D', 150)] }))
        .endCode,
      0xc05b,
    );
    sim.addFault({ mode: 'clear' });
    assert.equal(ask(sim, rd(150)).endCode, 0);
    sim.addFault({ mode: 'endcode', code: 0xc056, count: 2 });
    assert.equal(ask(sim, rd(0)).endCode, 0xc056);
    assert.equal(ask(sim, rd(0)).endCode, 0xc056);
    assert.equal(ask(sim, rd(0)).endCode, 0);
    sim.addFault({ mode: 'delay', delayMs: 250 });
    const p = sim.handleFrame(rd(0));
    assert.equal(p.action, 'respond');
    assert.equal(p.delayMs, 250);
    sim.addFault({ mode: 'none' });
    sim.addFault({ mode: 'garbage', bytes: 7 });
    const g = sim.handleFrame(rd(0)).buffers[0];
    assert.equal(g.length, 7);
    assert.equal(g[0], 0xff);
    sim.addFault({ mode: 'none' });
    sim.addFault({ mode: 'close' });
    assert.equal(sim.handleFrame(rd(0), 'tcp').action, 'close');
    assert.equal(sim.handleFrame(rd(0), 'udp').action, 'silent');
    assert.equal(sim.counters().faults, 1 + 3 + 2 + 1 + 1 + 2);
    assert.throws(() => sim.addFault({ mode: 'boom' }), /unknown fault mode/);
    assert.throws(() => sim.addFault({ mode: 'endcode', code: 'XYZ' }), /end code/);
    assert.throws(() => sim.addFault({ mode: 'silent', count: 0 }), /count/);
  });

  it('cmd, transport, frame and encoding limit a fault to that kind of request', () => {
    const sim = simWith(BASIC);
    sim.addFault({ mode: 'endcode', code: 'C05B', cmd: '1401', device: 'D', at: 0 });
    const wr = binReq({ cmd: 0x1401, sub: 0, data: [...dev('D', 0), 1, 0, 9, 0] });
    assert.equal(ask(sim, rd(0)).endCode, 0);
    assert.equal(ask(sim, wr).endCode, 0xc05b);
    sim.addFault({ mode: 'clear' });
    sim.addFault({ mode: 'silent', transport: 'udp' });
    assert.equal(sim.handleFrame(rd(0), 'tcp').action, 'respond');
    assert.equal(sim.handleFrame(rd(0), 'udp').action, 'silent');
    sim.addFault({ mode: 'clear' });
    sim.addFault({ mode: 'silent', frame: '4E', encoding: 'ascii' });
    assert.equal(sim.handleFrame(rd(0)).action, 'respond');
    assert.equal(
      sim.handleFrame(binReq({ frame: '4E', cmd: 0x0401, sub: 0, data: [...dev('D', 0), 1, 0] }))
        .action,
      'respond',
    );
    assert.equal(
      sim.handleFrame(asciiReq({ cmd: 0x0401, sub: 0, data: 'D*0000000001' })).action,
      'respond',
    );
    assert.equal(
      sim.handleFrame(asciiReq({ frame: '4E', cmd: 0x0401, sub: 0, data: 'D*0000000001' })).action,
      'silent',
    );
    assert.throws(() => sim.addFault({ mode: 'silent', cmd: '14' }), /cmd/);
    assert.throws(() => sim.addFault({ mode: 'silent', transport: 'x' }), /transport/);
    assert.throws(() => sim.addFault({ mode: 'silent', frame: '1E' }), /frame/);
    assert.throws(() => sim.addFault({ mode: 'silent', encoding: 'bcd' }), /encoding/);
  });

  it('refuse calls the socket layer, none/clear stops it', () => {
    const calls = [];
    const sim = new SimServer({ memory: loadMap(BASIC), onRefuseChange: (on) => calls.push(on) });
    sim.addFault({ mode: 'refuse' });
    assert.equal(sim.refusing, true);
    sim.addFault({ mode: 'none' });
    assert.deepEqual(calls, [true, false]);
  });

  it('counters and log', () => {
    const sim = simWith(BASIC);
    ask(sim, rd(0));
    ask(sim, rd(5000));
    ask(sim, asciiReq({ frame: '4E', serial: 9, cmd: 0x1401, sub: 0, data: 'D*0000100001ABCD' }));
    ask(sim, binReq({ cmd: 0x0403, sub: 0, data: [1, 1, ...dev('D', 0), ...dev('D', 2)] }));
    const c = sim.counters();
    assert.equal(c.requests, 4);
    assert.equal(c.responses, 4);
    assert.deepEqual(c.byCommand, { '0401': 2, 1401: 1, '0403': 1 });
    assert.deepEqual(c.endCodes, { '0000': 3, C056: 1 });
    assert.ok(c.bytesIn > 0 && c.bytesOut > 0);
    const log = sim.logEntries();
    assert.equal(log.length, 4);
    assert.deepEqual(
      { ...log[1], ts: 0 },
      {
        seq: 2,
        ts: 0,
        transport: 'tcp',
        frame: '3E',
        code: 'binary',
        cmd: '0401',
        sub: '0000',
        route: { network: 0, station: 255, moduleIo: 1023, moduleStation: 0 },
        device: 'D',
        at: 5000,
        points: 1,
        endCode: 'C056',
        result: 'ok',
      },
    );
    assert.equal(log[2].serial, 9);
    assert.deepEqual(log[2].data, [0xabcd]);
    assert.deepEqual([log[3].n, log[3].m], [1, 1]);
    assert.equal(sim.logEntries(3).length, 1);
    sim.reset();
    assert.equal(sim.counters().requests, 0);
    assert.equal(sim.logEntries().length, 0);
  });

  it('a frame of the other kind is dropped when --frame/--code restrict it', () => {
    const sim = new SimServer({ memory: loadMap(BASIC), accept: { frame: '4E', code: 'binary' } });
    assert.equal(sim.handleFrame(rd(0)).action, 'silent');
    assert.equal(
      sim.handleFrame(binReq({ frame: '4E', cmd: 0x0401, sub: 0, data: [...dev('D', 0), 1, 0] }))
        .action,
      'respond',
    );
    assert.equal(sim.counters().badFrames, 1);
  });

  it('parseFrame/encodeResponse round trip of the routing fields', () => {
    const h = parseFrame(asciiReq({ frame: '4E', serial: 0x1234, cmd: 0x0401, sub: 0 }));
    assert.equal(h.serial, 0x1234);
    assert.equal(encodeResponse(h, 0, '').toString(), 'D400123400000' + '0FF03FF0000040000');
  });
});

// ---- sockets and control API ------------------------------------------------------------------

const LOCAL = { host: '127.0.0.1', controlHost: '127.0.0.1', tcpPort: 0, controlPort: 0, now };

/** A TCP client that collects whole response frames. */
function client(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    const waiters = [];
    const frames = [];
    let closed = false;
    const flush = () => {
      while (waiters.length && (frames.length || closed)) waiters.shift()(frames.shift() ?? null);
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const t = buf.toString('latin1', 0, 4);
        let len = 0;
        if (buf[0] === 0xd0 && buf.length >= 9) len = 9 + buf.readUInt16LE(7);
        else if (buf[0] === 0xd4 && buf.length >= 13) len = 13 + buf.readUInt16LE(11);
        else if (t === 'D000' && buf.length >= 18)
          len = 18 + parseInt(buf.toString('latin1', 14, 18), 16);
        else if (t === 'D400' && buf.length >= 26)
          len = 26 + parseInt(buf.toString('latin1', 22, 26), 16);
        else if (buf.length > 0 && buf[0] !== 0xd0 && buf[0] !== 0xd4 && t[0] !== 'D')
          len = buf.length;
        if (len === 0 || buf.length < len) break;
        frames.push(buf.subarray(0, len));
        buf = buf.subarray(len);
      }
      flush();
    });
    sock.on('close', () => {
      closed = true;
      flush();
    });
    sock.on('error', () => {});
    sock.on('connect', () =>
      resolve({
        sock,
        send: (b) => sock.write(b),
        next: (ms = 2000) =>
          new Promise((res) => {
            const w = (f) => {
              clearTimeout(timer);
              res(f);
            };
            const timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(w), 1);
              res('timeout');
            }, ms);
            waiters.push(w);
            flush();
          }),
        closed: () => closed,
      }),
    );
    sock.once('error', reject);
  });
}

async function http(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('sockets and control API', () => {
  it('TCP: split frames, coalesced frames, both codes on one connection', async () => {
    const s = await startSim({ ...LOCAL, map: BASIC });
    try {
      s.server.memory.set('D', 3, 0x1234);
      const c = await client(s.tcpPort);
      const b = binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 3), 1, 0] });
      for (const byte of b) c.send(Buffer.from([byte]));
      assert.equal(hex(await c.next()), 'D0 00 00 FF FF 03 00 04 00 00 00 34 12');
      const a = asciiReq({ cmd: 0x0401, sub: 0, data: 'D*0000030001' });
      const b4 = binReq({
        frame: '4E',
        serial: 7,
        cmd: 0x0401,
        sub: 0,
        data: [...dev('D', 3), 1, 0],
      });
      c.send(Buffer.concat([a, b4, a]));
      assert.equal((await c.next()).toString(), 'D00000FF03FF00000800001234');
      assert.equal(hex((await c.next()).subarray(0, 4)), 'D4 00 07 00');
      assert.equal((await c.next()).toString(), 'D00000FF03FF00000800001234');
      // garbage that cannot be framed closes the connection
      c.send(Buffer.from('GARBAGE!'));
      assert.equal(await c.next(), null);
      assert.equal(c.closed(), true);
      assert.equal(s.server.counters().badFrames, 1);
    } finally {
      await s.close();
    }
  });

  it('UDP: one request per datagram, answer to the sender', async () => {
    const s = await startSim({ ...LOCAL, udpPort: 0, map: BASIC });
    const u = dgram.createSocket('udp4');
    try {
      s.server.memory.set('D', 1, 77);
      const got = new Promise((resolve) => u.once('message', resolve));
      u.send(binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 1), 1, 0] }), s.udpPort, '127.0.0.1');
      assert.equal(hex(await got), 'D0 00 00 FF FF 03 00 04 00 00 00 4D 00');
      const got2 = new Promise((resolve) => u.once('message', resolve));
      u.send(
        asciiReq({ frame: '4E', serial: 3, cmd: 0x0401, sub: 0, data: 'D*0000010001' }),
        s.udpPort,
        '127.0.0.1',
      );
      assert.equal((await got2).toString(), 'D4000003000000FF03FF000008000000' + '4D');
      assert.equal(s.server.logEntries().at(-1).transport, 'udp');
    } finally {
      u.close();
      await s.close();
    }
  });

  it('control API: set, mem, fault (close, delay, refuse, endcode), counters, log, state, reset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-sim-'));
    const logFile = join(dir, 'log.jsonl');
    const s = await startSim({ ...LOCAL, map: BASIC, logFile });
    const ctl = (m, p, b) => http(s.controlPort, m, p, b);
    try {
      assert.equal(
        (await ctl('POST', '/set', { device: 'D', at: 10, type: 'INT32', value: -2 })).status,
        200,
      );
      assert.deepEqual(
        (await ctl('GET', '/mem?device=D&at=10&count=2')).body.values,
        [0xfffe, 0xffff],
      );
      assert.equal((await ctl('GET', '/mem?device=D&at=10&type=INT32')).body.value, -2);
      await ctl('POST', '/set', { device: 'D', at: 20, type: 'STRING', value: 'MITSU-01' });
      assert.equal(
        (await ctl('GET', '/mem?device=D&at=20&type=STRING&length=8')).body.value,
        'MITSU-01',
      );
      await ctl('POST', '/set', { device: 'X', at: '1A', values: [1, 0, true] });
      assert.deepEqual((await ctl('GET', '/mem?device=X&at=26&count=3')).body.values, [1, 0, 1]);
      await ctl('POST', '/set', { device: 'D', at: 30, bit: 3, value: true });
      assert.deepEqual((await ctl('GET', '/mem?device=D&at=30')).body.values, [8]);
      assert.equal((await ctl('POST', '/set', { device: 'R', at: 0, value: 1 })).status, 400);
      assert.equal(
        (await ctl('POST', '/set', { device: 'D', at: 1999, values: [1, 2] })).status,
        400,
      );
      assert.equal((await ctl('GET', '/mem?device=D&at=-1')).status, 400);
      assert.equal((await ctl('POST', '/fault', { mode: 'nope' })).status, 400);
      assert.equal((await ctl('GET', '/nope')).status, 404);

      const req = binReq({ cmd: 0x0401, sub: 0, data: [...dev('D', 10), 1, 0] });
      let c = await client(s.tcpPort);
      await ctl('POST', '/fault', { mode: 'endcode', code: 'C051', device: 'D', at: 10, count: 1 });
      c.send(req);
      assert.equal(reply(await c.next()).endCode, 0xc051);
      c.send(req);
      assert.equal(reply(await c.next()).endCode, 0);

      await ctl('POST', '/fault', { mode: 'silent', count: 1 });
      c.send(req);
      assert.equal(await c.next(300), 'timeout');

      await ctl('POST', '/fault', { mode: 'delay', delayMs: 200, count: 1 });
      const t0 = Date.now();
      c.send(req);
      assert.equal(reply(await c.next()).endCode, 0);
      assert.ok(Date.now() - t0 >= 180);

      await ctl('POST', '/fault', { mode: 'garbage', count: 1 });
      c.send(req);
      assert.equal((await c.next())[0], 0xff);

      await ctl('POST', '/fault', { mode: 'close', count: 1 });
      c.send(req);
      assert.equal(await c.next(), null);

      await ctl('POST', '/fault', { mode: 'refuse' });
      assert.equal((await ctl('GET', '/faults')).body.refusing, true);
      await assert.rejects(client(s.tcpPort));
      await ctl('POST', '/fault', { mode: 'clear' });
      c = await client(s.tcpPort);
      c.send(req);
      assert.equal(reply(await c.next()).endCode, 0);
      c.sock.destroy();

      const counters = (await ctl('GET', '/counters')).body;
      assert.equal(counters.requests, 7);
      assert.equal(counters.byCommand['0401'], 7);
      assert.equal(counters.endCodes.C051, 1);
      assert.ok(counters.connections.accepted >= 2);
      assert.deepEqual((await ctl('GET', '/stats')).body.requests, 7);
      const log = (await ctl('GET', '/log?since=5')).body.entries;
      assert.deepEqual(
        log.map((e) => e.seq),
        [6, 7],
      );
      const lines = readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.equal(lines.length, 7);
      assert.equal(lines[0].result, 'fault:endcode');
      const state = (await ctl('GET', '/state')).body;
      assert.deepEqual(state.devices.M, { size: 2048, kind: 'bit' });
      assert.equal(state.xyNotation, 'hex');
      await ctl('POST', '/reset');
      assert.equal((await ctl('GET', '/counters')).body.requests, 0);
      assert.equal((await ctl('GET', '/mem?device=D&at=10&type=INT32')).body.value, -2);
    } finally {
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
