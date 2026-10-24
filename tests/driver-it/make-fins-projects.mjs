// Makes the projects and simulator maps of the Omron FINS integration tests (feature 018, T051): two
// project folders next to this file (format 1.1: a `fins` channel only exists from 1.1) and two maps of
// tools/fins-sim. The result is committed; run `node tests/driver-it/make-fins-projects.mjs` after a
// change of the Tags. The scenarios are in tests/driver-it/fins-it.mjs.
//
//   fins-all-types  channels `udp1` (FINS/UDP) and `tcp1` (FINS/TCP), both on the simulator `fins-sim`
//                   port 9600: the same Tags through each (U.* and T.*), Tags to write (W.*), Tags
//                   past the end of the simulated DM (E.*, end code 1103).
//   bench-500-fins  500 Tags on one FINS/UDP channel, normal group 1 s: 250 in one block, 250 one
//                   every 20 words (0104 multiple reads).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECT, idOf } from './fins-expect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const V = '1.1.0';

const write = (dir, name, obj) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
};

function project(name, id, connections, tags) {
  const dir = join(here, 'projects', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  write(dir, 'project.json', {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: id,
    projectName: `Kiểm thử driver FINS: ${name}`,
    projectVersion: '0.1.0',
    minRuntimeVersion: '1.1.0',
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    maxClients: 10,
  });
  write(dir, 'connections.json', connections);
  write(dir, 'tags.json', { schemaVersion: V, tags });
  write(dir, 'screens/main.screen.json', {
    schemaVersion: V,
    id: 'main',
    name: 'Tổng quan',
    size: { width: 1280, height: 720 },
    items: [
      {
        id: 'card1',
        type: 'widget',
        widget: 'card',
        x: 20,
        y: 20,
        width: 240,
        height: 120,
        props: { label: 'Giá trị đầu' },
        tags: { value: tags.find((t) => t.type !== 'BOOL' && t.type !== 'STRING').id },
      },
    ],
  });
}

const channel = (id, transport, devices) => ({
  id,
  name: `Giả lập Omron FINS/${transport.toUpperCase()}`,
  kind: 'fins',
  fins: { host: 'fins-sim', port: 9600, transport, connectTimeoutMs: 1000, reconnectMaxS: 4 },
  devices,
});
const ext = (id, device, type, address, source = {}, more = {}) => ({
  id,
  kind: 'external',
  type,
  ...more,
  source: { device, address, ...source },
});

// ------------------------------------------------------------------------ fins-all-types
// Values of the map, words as the PLC holds them (low word first).
const W = {
  D100: [64302], // INT16 -1234
  D101: [54321],
  D102: [52501, 1883], // INT32 123456789 = 0x075BCD15
  D104: [10240, 61035], // UINT32 4000000000 = 0xEE6B2800
  D106: [59769, 17142], // FLOAT32 123.456 = 0x42F6E979
  D110: [11544, 21572, 8699, 16393], // FLOAT64 pi = 0x400921FB54442D18
  D120: [1800, 1286, 772, 258], // INT64 0x0102030405060708
  D130: [17094, 41325, 8241], // "Bơm 1" = 42 C6 A1 6D 20 31
  D140: [0x1234], // BCD 1234
  D141: [0x5678, 0x1234], // BCD 12345678
  D150: [0x0008], // bit 3 on
  D160: [2000], // scaled 0..4000 -> 0..100: 50
  CIO10: [0x0008],
  W5: [0x0001],
  H2: [777],
  A448: [4242],
  E0_100: [4464, 1], // UINT32 70000
  EC_5: [65534], // INT16 -2
  T5: [150],
  C12: [7],
  D19995: [99],
};
function allTypes() {
  const devices = (id) => [{ id, name: 'CJ2M giả lập', node: 20, timeoutMs: 500 }];
  const tags = [];
  for (const [prefix, device] of [
    ['U', 'cj2u'],
    ['T', 'cj2t'],
  ]) {
    for (const [address, [type, , source]] of Object.entries(EXPECT))
      tags.push(ext(idOf(prefix, address), device, type, address.trim(), source ?? {}));
    tags.push(
      ext(
        `${prefix}.SCALED`,
        device,
        'FLOAT32',
        'D160',
        { rawType: 'INT16' },
        { scaling: { rawMin: 0, rawMax: 4000, engMin: 0, engMax: 100 } },
      ),
    );
  }
  // writes (both transports)
  const rw = { access: 'RW' };
  const lim = (min, max) => ({ ...rw, limits: { min, max } });
  for (const [prefix, device, base] of [
    ['WU', 'cj2u', 300],
    ['WT', 'cj2t', 400],
  ]) {
    tags.push(ext(`${prefix}.I16`, device, 'INT16', `D${base}`, {}, lim(-30000, 30000)));
    tags.push(ext(`${prefix}.BIT`, device, 'BOOL', `W${base / 100 + 10}.07`, {}, rw));
    tags.push(ext(`${prefix}.BCD`, device, 'UINT16', `D${base + 10}`, { bcd: true }, lim(0, 9999)));
    tags.push(ext(`${prefix}.F32`, device, 'FLOAT32', `D${base + 20}`, {}, lim(-1000, 1000)));
    tags.push(ext(`${prefix}.U32`, device, 'UINT32', `E1_${base}`, {}, lim(0, 4000000000)));
    tags.push(
      ext(
        `${prefix}.STR`,
        device,
        'STRING',
        `D${base + 30}`,
        { stringLength: 8 },
        {
          ...rw,
          limits: { maxLength: 8 },
        },
      ),
    );
  }
  // past the end of the simulated DM (limit D20000): one block with D19995, the split leaves it GOOD
  tags.push(ext('E.D19995', 'cj2u', 'INT16', 'D19995'));
  tags.push(ext('E.D20001', 'cj2u', 'INT16', 'D20001'));
  project(
    'fins-all-types',
    'driver-it-fins',
    {
      schemaVersion: V,
      scanGroups: { fast: 250, normal: 1000, slow: 5000 },
      channels: [channel('udp1', 'udp', devices('cj2u')), channel('tcp1', 'tcp', devices('cj2t'))],
    },
    tags,
  );
  const words = {};
  for (const [addr, values] of Object.entries(W)) {
    const m = /^(CIO|E[0-9A-C]|[DWHATC])_?(\d+)$/.exec(addr);
    words[m[1]] = words[m[1]] ?? {};
    words[m[1]][m[2]] = values;
  }
  writeFileSync(
    join(root, 'tools/fins-sim/maps/all-types.json'),
    JSON.stringify(
      {
        node: 20,
        words,
        flags: { T: { 5: true }, C: { 12: false } },
        limits: { D: 20000 },
        fill: [{ area: 'D', from: 0, to: 999, value: 0 }],
      },
      null,
      2,
    ) + '\n',
  );
}

// ------------------------------------------------------------------------ bench-500-fins
function bench() {
  const tags = [];
  for (let i = 0; i < 250; i++) tags.push(ext(`B.BLK${i}`, 'cj2', 'UINT16', `D${1000 + i}`));
  for (let i = 0; i < 250; i++) tags.push(ext(`B.SCT${i}`, 'cj2', 'UINT16', `D${5000 + 20 * i}`));
  project(
    'bench-500-fins',
    'bench-500-fins',
    {
      schemaVersion: V,
      scanGroups: { fast: 250, normal: 1000, slow: 5000 },
      channels: [channel('udp1', 'udp', [{ id: 'cj2', name: 'CJ2M giả lập', node: 20 }])],
    },
    tags,
  );
  // every Tag changes once a second: a ramp per Tag, periods spread
  const ramps = [];
  for (let i = 0; i < 250; i++)
    ramps.push({ area: 'D', address: 1000 + i, periodMs: 60000 + i * 7, max: 60000 });
  for (let i = 0; i < 250; i++)
    ramps.push({ area: 'D', address: 5000 + 20 * i, periodMs: 60000 + i * 11, max: 60000 });
  writeFileSync(
    join(root, 'tools/fins-sim/maps/bench-500.json'),
    JSON.stringify({ node: 20, ramps }, null, 2) + '\n',
  );
}

allTypes();
bench();
console.log('fins projects: fins-all-types, bench-500-fins; maps all-types, bench-500');
