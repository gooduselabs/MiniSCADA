// Test of the BACnet simulator (feature 020): its answers to the ASHRAE 135 Annex F requests are the bytes of
// tests/bacnet-vectors/frames.json (the vectors of the C++ codec), the priority array, Who-Is, the faults and
// the UDP socket.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Reader, parseFrame } from './codec.mjs';
import { SimServer } from './server.mjs';
import { startSim } from './sim.mjs';

const vectors = JSON.parse(
  readFileSync(new URL('../../tests/bacnet-vectors/frames.json', import.meta.url), 'utf8'),
);
const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const enc = (name) => hex(vectors.encode.find((v) => v.name.startsWith(name)).hex);
const dec = (name) => hex(vectors.decode.find((v) => v.name.startsWith(name)).hex);
const from = { address: '10.0.0.9', port: 47808 };

const device = (objects, extra = {}) =>
  new SimServer({ map: { devices: [{ instance: 1001, objects, ...extra }] } });

test('the answer to F.3.5 ReadProperty is the F.3.5 ACK', () => {
  const s = device([{ type: 'AI', instance: 5, value: 72.3 }]);
  const out = s.handle(enc('F.3.5'), from);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.toString('hex'), dec('F.3.5').toString('hex'));
});

test('the answer to F.3.7 ReadPropertyMultiple is the F.3.7 ACK', () => {
  const s = device([{ type: 'AI', instance: 16, value: 72.3 }]);
  const out = s.handle(enc('F.3.7'), from);
  assert.equal(out[0].data.toString('hex'), dec('F.3.7').toString('hex'));
});

test('F.3.9 WriteProperty is a Simple-ACK and sets priority 16', () => {
  const s = device([{ type: 'AV', instance: 1, value: 0 }]);
  const out = s.handle(enc('F.3.9'), from);
  assert.equal(out[0].data.toString('hex'), dec('F.3.9').toString('hex'));
  const o = s.object(1001, 'AV:1');
  assert.equal(o.priority[15], 180);
  assert.equal(s.present(o), 180);
});

test('relinquish clears the slot and present-value falls back', () => {
  const s = device([{ type: 'AO', instance: 1, value: 5 }]);
  s.object(1001, 'AO:1').priority[7] = 50;
  assert.equal(s.present(s.object(1001, 'AO:1')), 50);
  const out = s.handle(enc('relinquish AO 1'), from);
  assert.equal(parseFrame(out[0].data).pdu, 2);
  assert.equal(s.present(s.object(1001, 'AO:1')), 5);
});

test('unknown object, write to an input, priority 6 are errors', () => {
  const s = device([{ type: 'AI', instance: 1, value: 1 }]);
  const out = s.handle(enc('F.3.5'), from); // AI:5 does not exist
  const f = parseFrame(out[0].data);
  assert.equal(f.pdu, 5);
  const r = new Reader(f.data);
  assert.deepEqual([r.value().value, r.value().value], [1, 31]);
  const wr = s.handle(enc('WriteProperty BO 2'), from); // no BO:2
  assert.equal(parseFrame(wr[0].data).pdu, 5);
});

test('Who-Is answers I-Am of every device in range, behind the router with SNET', () => {
  const s = new SimServer({
    map: {
      devices: [
        { instance: 1001, objects: [] },
        { instance: 7, network: 5, mac: '07', objects: [] },
      ],
    },
  });
  const all = s.handle(enc('Who-Is broadcast'), from);
  assert.equal(all.length, 2);
  const routed = parseFrame(all[1].data);
  assert.equal(routed.snet, 5);
  assert.deepEqual(routed.sadr, [7]);
  const ranged = s.handle(enc('Who-Is cục bộ'), from);
  assert.equal(ranged.length, 1);
  assert.equal(parseFrame(ranged[0].data).bvlc, 0x0b);
  // a request routed to network 5 MAC 07 reaches the VAV
  const rp = s.handle(enc('ReadProperty qua router'), from);
  assert.equal(parseFrame(rp[0].data).snet, 5);
});

test('faults: no RPM, a small max APDU, drops, errors', () => {
  const s = device([{ type: 'AI', instance: 16, value: 1 }]);
  s.addFault({ kind: 'noRpm' });
  assert.equal(s.handle(enc('F.3.7'), from)[0].data.at(-1), 9); // reject unrecognized-service
  s.addFault({ kind: 'clear' });
  s.addFault({ kind: 'maxApdu', value: 10 });
  const ab = parseFrame(s.handle(enc('F.3.7'), from)[0].data);
  assert.equal(ab.pdu, 7);
  assert.equal(ab.service, 4);
  s.addFault({ kind: 'clear' });
  s.addFault({ kind: 'drop', count: 1 });
  assert.equal(s.handle(enc('F.3.7'), from).length, 0);
  assert.equal(s.handle(enc('F.3.7'), from).length, 1);
  s.addFault({ kind: 'error', code: 40 });
  assert.equal(parseFrame(s.handle(enc('F.3.7'), from)[0].data).pdu, 5);
  assert.equal(s.counters.dropped, 1);
});

test('object-list whole and by index; status-flags with out-of-service', () => {
  const s = device([
    { type: 'AI', instance: 1, value: 1, outOfService: true, flags: 2 },
    { type: 'BV', instance: 2, value: true },
  ]);
  const dev = s.devices[0];
  const list = s.read(dev, s.findObject(dev, { type: 8, instance: 1001 }), 76);
  assert.equal(list.values.length, 3);
  assert.equal(
    s.read(dev, s.findObject(dev, { type: 8, instance: 1001 }), 76, 0).values[0].value,
    3,
  );
  const flags = s.read(dev, s.object(1001, 'AI:1'), 111).values[0];
  assert.deepEqual(flags, { tag: 'bits', value: 10, count: 4 });
});

test('over UDP', async () => {
  const sim = await startSim({
    map: { devices: [{ instance: 1001, objects: [{ type: 'AI', instance: 5, value: 72.3 }] }] },
    port: 0,
    controlPort: 0,
  });
  const sock = dgram.createSocket('udp4');
  try {
    const got = await new Promise((resolve, reject) => {
      sock.once('message', resolve);
      sock.once('error', reject);
      sock.send(enc('F.3.5'), sim.port, '127.0.0.1');
    });
    assert.equal(got.toString('hex'), dec('F.3.5').toString('hex'));
    const res = await fetch(`http://127.0.0.1:${sim.controlPort}/counters`);
    assert.equal((await res.json()).responses, 1);
    const set = await fetch(`http://127.0.0.1:${sim.controlPort}/set`, {
      method: 'POST',
      body: JSON.stringify({ device: 1001, object: 'AI:5', value: 1.5, flags: 2 }),
    });
    assert.equal((await set.json()).presentValue, 1.5);
  } finally {
    sock.close();
    await sim.close();
  }
});
