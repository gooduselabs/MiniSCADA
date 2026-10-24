// Makes the projects of the BACnet/IP integration tests (feature 020): small format 1.1 projects with one
// `bacnet` channel to the simulator of tools/bacnet-sim (host `sim`, port 47808) and the Tags the scenarios read
// and write. The objects match tools/bacnet-sim/maps/all-types.json and bench-500.json.
// The result is committed; run `node tests/driver-it-bacnet/make-projects.mjs` after a change.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const V = '1.1.0';
const write = (dir, name, obj) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
};

function project(name, devices, tags) {
  const dir = join(here, 'projects', name);
  rmSync(dir, { recursive: true, force: true });
  write(dir, 'project.json', {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: `bacnet-it-${name}`,
    projectName: `Kiểm thử driver BACnet/IP: ${name}`,
    projectVersion: '0.1.0',
    minRuntimeVersion: V,
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    maxClients: 10,
  });
  write(dir, 'connections.json', {
    schemaVersion: V,
    scanGroups: { fast: 250, normal: 1000, slow: 5000 },
    channels: [
      {
        id: 'bms',
        name: 'Giả lập BACnet',
        kind: 'bacnet',
        bacnet: { broadcast: '172.30.20.255', reconnectMaxS: 4 },
        devices,
      },
    ],
  });
  write(dir, 'tags.json', { schemaVersion: V, tags });
  write(dir, 'screens/main.screen.json', {
    schemaVersion: V,
    id: 'main',
    name: 'Main',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    fitMode: 'contain',
    items: [
      {
        id: 'card1',
        type: 'widget',
        widget: 'card',
        x: 20,
        y: 20,
        width: 240,
        height: 110,
        props: { label: tags[0].id },
        tags: { value: tags[0].id },
      },
    ],
  });
}

const ext = (device, id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
  source: {
    device,
    address,
    ...(extra.stringLength ? { stringLength: extra.stringLength } : {}),
    ...(extra.scanGroup ? { scanGroup: extra.scanGroup } : {}),
  },
});
const RW = (min, max) => ({ access: 'RW', limits: { min, max } });
const ahu = (...a) => ext('ahu1', ...a);
const vav = (...a) => ext('vav7', ...a);

// read-all-bacnet: every object type and property kind, the writable objects, a missing object, a
// device behind a router without ReadPropertyMultiple
project(
  'read-all-bacnet',
  [
    { id: 'ahu1', name: 'AHU-1', deviceInstance: 1001, host: 'sim' },
    {
      id: 'vav7',
      name: 'VAV-7 sau router',
      deviceInstance: 7,
      host: 'sim',
      network: 5,
      mac: '07',
      maxApdu: 480,
    },
  ],
  [
    ahu('AHU.AI1', 'FLOAT32', 'AI:1'),
    ahu('AHU.AI2', 'FLOAT64', 'AI:2'),
    ahu('AHU.AI3_FAULT', 'FLOAT32', 'AI:3'),
    ahu('AHU.AI4_OOS', 'FLOAT32', 'AI:4'),
    ahu('AHU.AO1', 'FLOAT32', 'AO:1', RW(0, 100)),
    ahu('AHU.AV5', 'FLOAT32', 'AV:5@8', RW(0, 50)),
    ahu('AHU.BI1', 'BOOL', 'BI:1'),
    ahu('AHU.BO2', 'BOOL', 'BO:2', { access: 'RW' }),
    ahu('AHU.BV3', 'BOOL', 'BV:3', { access: 'RW' }),
    ahu('AHU.MSI1', 'UINT16', 'MSI:1'),
    ahu('AHU.MSO1', 'UINT16', 'MSO:1', RW(1, 3)),
    ahu('AHU.MSV3', 'UINT16', 'MSV:3', RW(1, 5)),
    ahu('AHU.UNITS', 'UINT16', 'AI:1:units', { scanGroup: 'slow' }),
    ahu('AHU.FLAGS3', 'UINT16', 'AI:3:status-flags'),
    ahu('AHU.NAME', 'STRING', 'DEV:1001:object-name', { stringLength: 32, scanGroup: 'slow' }),
    ahu('AHU.MISSING', 'FLOAT32', 'AI:99'),
    ahu('AHU.REL8', 'BOOL', 'AV:5:relinquish@8', { access: 'RW' }),
    vav('VAV.AI1', 'FLOAT32', 'AI:1'),
    vav('VAV.AO1', 'FLOAT32', 'AO:1', RW(0, 100)),
  ],
);

// bench-500-bacnet: 300 AV (the simulator moves each on every read), 100 BV, 100 MSV, 1 s
const bench = [];
const dev = (...a) => ext('bench', ...a);
for (let i = 1; i <= 300; i++) bench.push(dev(`B.AV${i}`, 'FLOAT32', `AV:${i}`));
for (let i = 1; i <= 100; i++) bench.push(dev(`B.BV${i}`, 'BOOL', `BV:${i}`));
for (let i = 1; i <= 100; i++) bench.push(dev(`B.MSV${i}`, 'UINT16', `MSV:${i}`));
project(
  'bench-500-bacnet',
  [{ id: 'bench', name: 'BENCH-500', deviceInstance: 2001, host: 'sim' }],
  bench,
);
