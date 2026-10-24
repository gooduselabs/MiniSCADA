// Makes the projects of the S7 integration tests (feature 016 T021): small format 1.1 projects with
// one `s7` channel to the simulator of tools/s7-sim (host `sim`, port 102) and the Tags the
// scenarios read and write. The addresses match tools/s7-sim/maps/all-types.json and bench-500.json.
// The result is committed; run `node tests/driver-it-s7/make-projects.mjs` after a change.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const V = '1.1.0';
const write = (dir, name, obj) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
};

function project(name, tags, { pduSize = 960 } = {}) {
  const dir = join(here, 'projects', name);
  rmSync(dir, { recursive: true, force: true });
  write(dir, 'project.json', {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: `s7-it-${name}`,
    projectName: `Kiểm thử driver S7: ${name}`,
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
        id: 's7-1',
        name: 'Giả lập S7',
        kind: 's7',
        tcp: { host: 'sim', port: 102, connectTimeoutMs: 1000, reconnectMaxS: 4 },
        s7: { rack: 0, slot: 1, pduSize },
        devices: [{ id: 'cpu1', name: 'CPU giả lập', timeoutMs: 400 }],
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

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
  source: {
    device: 'cpu1',
    address,
    ...(extra.stringLength ? { stringLength: extra.stringLength } : {}),
    ...(extra.scanGroup ? { scanGroup: extra.scanGroup } : {}),
  },
});

// read-all-types-s7: every S7 type, the writable area, three Tags the PLC refuses
const RW = (min, max) => ({ access: 'RW', limits: { min, max } });
project('read-all-types-s7', [
  ext('S7.DB_BOOL', 'BOOL', 'DB1.DBX0.0'),
  ext('S7.DB_BOOL5', 'BOOL', 'DB1.DBX0.5'),
  ext('S7.DB_BYTE', 'UINT16', 'DB1.DBB1'),
  ext('S7.DB_INT', 'INT16', 'DB1.DBW2'),
  ext('S7.DB_WORD', 'UINT16', 'DB1.DBW4'),
  ext('S7.DB_DINT', 'INT32', 'DB1.DBD6'),
  ext('S7.DB_DWORD', 'UINT32', 'DB1.DBD10'),
  ext('S7.DB_REAL', 'FLOAT32', 'DB1.DBD14'),
  ext('S7.DB_LREAL', 'FLOAT64', 'DB1.LREAL18'),
  ext('S7.DB_CHAR', 'STRING', 'DB1.DBB26', { stringLength: 1 }),
  ext('S7.DB_CHARS', 'STRING', 'DB1.DBB27', { stringLength: 4 }),
  ext('S7.DB_STRING', 'STRING', 'DB1.STRING32', { stringLength: 20 }),
  ext('S7.DB2_INT', 'INT16', 'DB2.DBW0'),
  ext('S7.M_BOOL', 'BOOL', 'M0.1', { scanGroup: 'fast' }),
  ext('S7.M_WORD', 'UINT16', 'MW10'),
  ext('S7.M_REAL', 'FLOAT32', 'MD20'),
  ext('S7.I_BOOL', 'BOOL', 'I0.1'),
  ext('S7.I_WORD', 'INT16', 'IW2'),
  ext('S7.Q_BOOL', 'BOOL', 'Q0.0', { access: 'RW' }),
  ext('S7.Q_BYTE', 'UINT16', 'QB1', RW(0, 255)),
  ext('S7.W_BOOL', 'BOOL', 'DB1.DBX60.0', { access: 'RW' }),
  ext('S7.W_INT', 'INT16', 'DB1.DBW62', RW(-30000, 30000)),
  ext('S7.W_REAL', 'FLOAT32', 'DB1.DBD64', RW(-1000, 1000)),
  ext('S7.W_STRING', 'STRING', 'DB1.STRING70', { access: 'RW', stringLength: 10 }),
  ext('S7.W_BYTE', 'UINT16', 'DB1.DBB84', RW(0, 255)),
  ext('S7.W_DINT', 'INT32', 'DB1.DBD86', RW(-1000000, 1000000)),
  ext('S7.W_LREAL', 'FLOAT64', 'DB1.LREAL90', RW(-1e6, 1e6)),
  ext('S7.DENIED', 'INT16', 'DB3.DBW0'),
  ext('S7.NO_DB', 'INT16', 'DB9.DBW0'),
  ext('S7.OUT_OF_RANGE', 'INT16', 'DB2.DBW100'),
]);

// bench-500-s7: 250 INT and 125 REAL in DB10 (animated by the simulator), 125 BOOL in M, 1 s
const bench = [];
for (let i = 0; i < 250; i++) bench.push(ext(`B.INT${i}`, 'INT16', `DB10.DBW${i * 2}`));
for (let i = 0; i < 125; i++) bench.push(ext(`B.REAL${i}`, 'FLOAT32', `DB10.DBD${500 + i * 4}`));
for (let i = 0; i < 125; i++)
  bench.push(ext(`B.BIT${i}`, 'BOOL', `M${Math.floor(i / 8)}.${i % 8}`));
project('bench-500-s7', bench, { pduSize: 480 });
