// node --test tools/fins-sim (feature 018, T050): the frames of the simulator on tests/fins-vectors/frames.json,
// the memory, every fault, and the simulator on real UDP and TCP sockets of the loopback.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildResponse, parseCommand, splitTcp, tcpMessage } from './codec.mjs';
import { FinsMemory } from './memory.mjs';
import { SimServer } from './server.mjs';
import { startSim } from './sim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, '../../tests/fins-vectors/frames.json'), 'utf8'),
);
const hex = (s) =>
  Buffer.from(
    s
      .split(' ')
      .filter(Boolean)
      .map((b) => parseInt(b, 16)),
  );
const toHex = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** A command frame from node 5 to node 20 with `sid`. */
function cmd(sid, command, params) {
  return Buffer.concat([
    Buffer.from([0x80, 0, 2, 0, 20, 0, 0, 5, 0, sid, command >> 8, command & 0xff]),
    Buffer.from(params),
  ]);
}
const read = (sid, code, addr, bit, count) =>
  cmd(sid, 0x0101, [code, addr >> 8, addr & 0xff, bit, count >> 8, count & 0xff]);

test('the command vectors parse to their parameters', () => {
  for (const c of vectors.commands) {
    const p = parseCommand(hex(c.hex));
    assert.equal(p.sid, c.sid, c.name);
    assert.equal(p.command.toString(16).padStart(4, '0'), c.command);
    if (c.params.kind === 'read' || c.params.kind === 'write') {
      assert.equal(p.code, parseInt(c.params.areaCode, 16));
      assert.equal(p.address, c.params.address);
      assert.equal(p.bit, c.params.bit);
      assert.equal(p.count, c.params.count);
    }
    if (c.params.kind === 'multi')
      assert.deepEqual(
        p.items.map((i) => [i.code.toString(16).toUpperCase(), i.address, i.bit]),
        c.params.items,
      );
  }
});

test('a response is the command with the addresses swapped, ICF C0 and the end code', () => {
  const c = parseCommand(hex(vectors.commands[0].hex));
  assert.equal(toHex(buildResponse(c, 0x1103)), 'C0 00 02 00 05 00 00 0A 00 01 01 01 11 03');
  assert.equal(
    toHex(buildResponse(c, 0, Buffer.from([0, 1]))),
    'C0 00 02 00 05 00 00 0A 00 01 01 01 00 00 00 01',
  );
});

test('FINS/TCP messages are cut from the stream like the vectors say', () => {
  for (const t of vectors.tcp.filter((x) => x.split)) {
    const r = splitTcp(hex(t.hex));
    if (t.split === 'Bad') assert.equal(r.lost, true, t.name);
    else if (t.split === 'NeedMore') assert.equal(r.messages.length, 0, t.name);
    else {
      assert.equal(r.messages.length, 1, t.name);
      assert.equal(r.messages[0].command, t.command);
      assert.equal(r.messages[0].error, t.error);
    }
  }
  const node = vectors.tcp.find((x) => x.name === 'node-request-5');
  assert.equal(toHex(tcpMessage(0, 0, Buffer.from([0, 0, 0, 5]))), node.hex);
});

test('the memory reads words, bits, flags, counters at 0x8000, EM banks and the limits', () => {
  const m = new FinsMemory({
    words: { D: { 100: [1, 2] }, E3: { 7: [9] }, C: { 12: [42] } },
    flags: { T: { 5: true } },
    limits: { D: 200 },
  });
  const s = new SimServer({ memory: m });
  const words = s.handleFrame(read(1, 0x82, 100, 0, 2));
  assert.equal(toHex(words.buffers[0].subarray(14)), '00 01 00 02');
  assert.equal(toHex(s.handleFrame(read(2, 0xa3, 7, 0, 1)).buffers[0].subarray(14)), '00 09');
  assert.equal(toHex(s.handleFrame(read(3, 0x89, 0x800c, 0, 1)).buffers[0].subarray(14)), '00 2A');
  assert.equal(toHex(s.handleFrame(read(4, 0x09, 5, 0, 2)).buffers[0].subarray(14)), '01 00');
  assert.equal(toHex(s.handleFrame(read(5, 0x02, 100, 0, 1)).buffers[0].subarray(14)), '01');
  assert.equal(toHex(s.handleFrame(read(6, 0x82, 199, 0, 2)).buffers[0].subarray(12)), '11 03');
  const multi = s.handleFrame(cmd(7, 0x0104, [0x82, 0, 100, 0, 0x09, 0, 5, 0, 0x02, 0, 101, 1]));
  assert.equal(toHex(multi.buffers[0].subarray(12)), '00 00 82 00 01 09 01 02 01');
  const model = s.handleFrame(cmd(8, 0x0501, []));
  assert.match(model.buffers[0].subarray(14, 34).toString('latin1'), /^CJ2M-CPU31/);
});

test('writes change words and bits; flags and A0-A447 are refused', () => {
  const s = new SimServer({ memory: {} });
  const w = cmd(1, 0x0102, [0x82, 0, 10, 0, 0, 2, 0x12, 0x34, 0x56, 0x78]);
  assert.equal(toHex(s.handleFrame(w).buffers[0].subarray(12)), '00 00');
  assert.equal(s.memory.get('D', 10), 0x1234);
  assert.equal(s.memory.get('D', 11), 0x5678);
  s.handleFrame(cmd(2, 0x0102, [0x31, 0, 5, 3, 0, 1, 1]));
  assert.equal(s.memory.get('W', 5), 8);
  const flag = s.handleFrame(cmd(3, 0x0102, [0x09, 0, 5, 0, 0, 1, 1]));
  assert.equal(toHex(flag.buffers[0].subarray(12)), '21 01');
  const aux = s.handleFrame(cmd(4, 0x0102, [0xb3, 0, 100, 0, 0, 1, 0, 1]));
  assert.equal(toHex(aux.buffers[0].subarray(12)), '21 01');
});

test('faults: silent, late, end code, wrong SID, garbage, filters, skip and count', () => {
  const s = new SimServer({ memory: {} });
  s.addFault({ kind: 'silent', command: '0101', count: 2 });
  assert.equal(s.handleFrame(read(1, 0x82, 0, 0, 1)).action, 'silent');
  assert.equal(s.handleFrame(cmd(2, 0x0501, [])).action, 'respond'); // filter: 0101 only
  assert.equal(s.handleFrame(read(3, 0x82, 0, 0, 1)).action, 'silent');
  assert.equal(s.handleFrame(read(4, 0x82, 0, 0, 1)).action, 'respond');
  s.addFault({ kind: 'late', delayMs: 700 });
  assert.equal(s.handleFrame(read(5, 0x82, 0, 0, 1)).delayMs, 700);
  s.addFault({ kind: 'endCode', endCode: '2203', from: 50, to: 60 });
  assert.equal(toHex(s.handleFrame(read(6, 0x82, 0, 0, 1)).buffers[0].subarray(12)), '00 00 00 00');
  assert.equal(toHex(s.handleFrame(read(7, 0x82, 45, 0, 10)).buffers[0].subarray(12)), '22 03');
  s.addFault({ kind: 'badSid', skip: 1 });
  assert.equal(s.handleFrame(read(8, 0x82, 0, 0, 1)).buffers.length, 1);
  const two = s.handleFrame(read(9, 0x82, 0, 0, 1));
  assert.deepEqual(
    two.buffers.map((b) => b[9]),
    [10, 9],
  );
  s.addFault({ kind: 'garbage' });
  assert.equal(s.handleFrame(read(10, 0x82, 0, 0, 1)).action, 'garbage');
  assert.throws(() => s.addFault({ kind: 'boom' }));
  const c = s.counters();
  assert.equal(c.faults, 6);
  assert.equal(c.byCommand['0101'], 9);
  assert.equal(s.logEntries(0).at(-1).result, 'garbage');
});

test('the simulator answers over UDP and over TCP with the node handshake', async () => {
  const sim = await startSim({
    map: { node: 20, words: { D: { 0: [7] } } },
    port: 0,
    controlPort: 0,
  });
  try {
    // UDP: the answer goes back to the source port
    const u = dgram.createSocket('udp4');
    const got = new Promise((resolve) => u.once('message', resolve));
    u.send(read(0x21, 0x82, 0, 0, 1), sim.port, '127.0.0.1');
    const msg = await got;
    assert.equal(toHex(msg), 'C0 00 02 00 05 00 00 14 00 21 01 01 00 00 00 07');
    u.close();

    // TCP: the handshake, then a frame
    const sock = net.connect(sim.port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    let buf = Buffer.alloc(0);
    const next = () =>
      new Promise((resolve) => {
        const on = (d) => {
          buf = Buffer.concat([buf, d]);
          const r = splitTcp(buf);
          if (r.messages.length) {
            buf = Buffer.from(r.rest);
            sock.off('data', on);
            resolve(r.messages[0]);
          }
        };
        sock.on('data', on);
      });
    sock.write(tcpMessage(0, 0, Buffer.from([0, 0, 0, 0])));
    const hs = await next();
    assert.equal(hs.command, 1);
    assert.equal(hs.body.readUInt32BE(4), 20);
    const client = hs.body.readUInt32BE(0);
    assert.ok(client >= 100);
    sock.write(tcpMessage(2, 0, read(0x22, 0x82, 0, 0, 1)));
    const fr = await next();
    assert.equal(fr.command, 2);
    assert.equal(toHex(fr.body.subarray(12)), '00 00 00 07');
    sock.destroy();

    // a refused handshake
    sim.server.addFault({ kind: 'tcpRefuse', error: 0x20 });
    const s2 = net.connect(sim.port, '127.0.0.1');
    await new Promise((r) => s2.once('connect', r));
    const refused = new Promise((resolve) => s2.once('data', resolve));
    s2.write(tcpMessage(0, 0, Buffer.from([0, 0, 0, 0])));
    const r = splitTcp(await refused);
    assert.equal(r.messages[0].error, 0x20);
    s2.destroy();
  } finally {
    await sim.close();
  }
});
