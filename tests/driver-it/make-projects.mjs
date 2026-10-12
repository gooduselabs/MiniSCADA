// Makes the projects of the driver integration tests (specs/006 T110): the two folders next to
// this file, from the 0.2 vector `v02-valid-no-connections` (its screen and tables) plus a
// connection to the simulator of tools/modbus-sim (host `sim`, port 1502) and the Tags the
// scenarios read and write. The result is committed; run `node tests/driver-it/make-projects.mjs`
// after a change of the Tags. The addresses match tools/modbus-sim/maps/all-types.json and
// bench-500.json.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vector = join(here, '..', 'project-vectors', 'v02-valid-no-connections');

const write = (dir, name, obj) =>
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');

function base(name, id, connections, tags, extras = {}) {
  const dir = join(here, 'projects', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(vector, dir, { recursive: true });
  rmSync(join(dir, 'expected.json'), { force: true });
  const project = {
    format: 'matscada-project',
    schemaVersion: '0.2.0',
    projectId: id,
    projectName: `Kiểm thử driver: ${name}`,
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.5.0',
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    valueTables: ['TrangThaiBom'],
    watchTables: ['van-hanh'],
    maxClients: 10,
    ...(extras.project ?? {}),
  };
  if (!connections) delete project.connectionFile;
  write(dir, 'project.json', project);
  if (connections) write(dir, 'connections.json', connections);
  else rmSync(join(dir, 'connections.json'), { force: true });
  if (extras.logging) write(dir, 'logging.json', extras.logging);
  write(dir, 'tags.json', { schemaVersion: '0.2.0', tags });
}

const conn = (extraDevice = {}, scan = { fast: 250, normal: 1000, slow: 5000 }) => ({
  schemaVersion: '0.2.0',
  scanGroups: scan,
  channels: [
    {
      id: 'plc1',
      name: 'Giả lập Modbus',
      kind: 'modbus-tcp',
      tcp: { host: 'sim', port: 1502, connectTimeoutMs: 1000, reconnectMaxS: 4 },
      devices: [
        {
          id: 'd1',
          name: 'PLC giả lập',
          unitId: 1,
          timeoutMs: 400,
          write: { registerBit: 'mask' },
          ...extraDevice,
        },
      ],
    },
  ],
});

const sim = {
  id: 'A.WAVE',
  kind: 'simulation',
  type: 'FLOAT32',
  sim: { kind: 'ramp', from: 0, to: 100, periodMs: 10000 },
};
const ext = (id, type, address, more = {}, source = {}) => ({
  id,
  kind: 'external',
  type,
  source: { device: 'd1', address, ...source },
  ...more,
});

// ---- read-all-types: every type and order of tools/modbus-sim/maps/all-types.json ----
const orders = ['ABCD', 'CDAB', 'BADC', 'DCBA'];
const tags = [
  sim,
  ext('R.COIL0', 'BOOL', 'C0'),
  ext('R.COIL1', 'BOOL', 'C1'),
  ext('R.COIL2', 'BOOL', 'C2'),
  ext('R.DI1', 'BOOL', 'DI1'),
  ext('R.BIT0', 'BOOL', 'HR0.0'),
  ext('R.BIT1', 'BOOL', 'HR0.1'),
  ext('R.BIT5', 'BOOL', 'HR0.5'),
  ext('R.I16', 'INT16', 'HR1'),
  ext('R.U16', 'UINT16', 'HR2'),
  ...orders.map((o, i) => ext(`R.I32_${o}`, 'INT32', `HR${10 + 2 * i}`, {}, { byteOrder: o })),
  ext('R.U32', 'UINT32', 'HR20'),
  ...orders.map((o, i) => ext(`R.F32_${o}`, 'FLOAT32', `HR${30 + 2 * i}`, {}, { byteOrder: o })),
  ...orders.map((o, i) => ext(`R.I64_${o}`, 'INT64', `HR${40 + 4 * i}`, {}, { byteOrder: o })),
  ext('R.U64', 'UINT64', 'HR60'),
  ext('R.F64', 'FLOAT64', 'HR70'),
  ext('R.STR', 'STRING', 'HR80', {}, { stringLength: 8 }),
  ext('R.IR5', 'UINT16', 'IR5'),
  ext(
    'R.SCALED',
    'FLOAT32',
    'HR100',
    { unit: '%', scaling: { rawMin: 0, rawMax: 27648, engMin: 0, engMax: 100, clamp: true } },
    { rawType: 'INT16' },
  ),
  // writable
  ext('R.SP', 'FLOAT32', 'HR200', { access: 'RW', limits: { min: 0, max: 90 } }),
  ext('R.CNT', 'INT16', 'HR202', { access: 'RW' }),
  ext('R.RUN', 'BOOL', 'C10', { access: 'RW' }),
  ext('R.PULSE', 'BOOL', 'C11', { access: 'RW' }, { readback: false }),
  ext('R.FLAG', 'BOOL', 'HR204.3', { access: 'RW' }),
  ext(
    'R.SCALED_SP',
    'FLOAT32',
    'HR210',
    { unit: '%', access: 'RW', scaling: { rawMin: 0, rawMax: 27648, engMin: 0, engMax: 100 } },
    { rawType: 'INT16' },
  ),
  ext('R.NAMEW', 'STRING', 'HR220', { access: 'RW' }, { stringLength: 8 }),
  {
    id: 'R.INT',
    kind: 'internal',
    type: 'FLOAT32',
    access: 'RW',
    initial: 5,
    limits: { min: 0, max: 100 },
  },
  {
    id: 'R.SIMMAN',
    kind: 'simulation',
    type: 'INT16',
    access: 'RW',
    sim: { kind: 'manual', initial: 0 },
  },
];
base('read-all-types', 'driver-it-read', conn(), tags);

// ---- bench-500-modbus: 500 INT16 side by side, all changing every second ----
const bench = [sim];
for (let i = 0; i < 500; i++)
  bench.push(ext(`B.T${String(i + 1).padStart(4, '0')}`, 'UINT16', `HR${i}`));
base(
  'bench-500-modbus',
  'driver-it-bench',
  conn({}, { fast: 250, normal: 1000, slow: 5000 }),
  bench,
);
// ---- calc-200: the 500 Tags of bench-500 plus 200 calculated Tags (2-5 inputs each) and 100 internal
// Tags (feature 006 T180, US4-4, SC-004 on x64). The calculated Tag Cnnn adds the inputs
// B.T<k> ... ; its inputs are spread so that a delta carries the input and the sum together. The
// first 10 internal Tags keep their value through a power cut (retain, scenario "retain").
const calc = [sim];
for (let i = 0; i < 500; i++)
  calc.push(ext(`B.T${String(i + 1).padStart(4, '0')}`, 'UINT16', `HR${i}`));
for (let k = 0; k < 200; k++) {
  const n = 2 + (k % 4); // 2, 3, 4 or 5 inputs
  const inputs = [];
  for (let j = 0; j < n; j++) inputs.push((k * 2 + j * 97) % 500);
  const ids = [...new Set(inputs)].map((i) => `B.T${String(i + 1).padStart(4, '0')}`);
  const id = `C.S${String(k + 1).padStart(3, '0')}`;
  calc.push({ id, kind: 'calculated', type: 'FLOAT64', expression: ids.join(' + ') });
}
for (let k = 0; k < 100; k++)
  calc.push({
    id: `I.V${String(k + 1).padStart(3, '0')}`,
    kind: 'internal',
    type: 'FLOAT64',
    access: 'RW',
    initial: k,
    ...(k < 10 ? { retain: true } : {}),
  });
base('calc-200', 'driver-it-calc', conn({}, { fast: 250, normal: 1000, slow: 5000 }), calc);
// ---- smoke-armhf: no Modbus (the toolchain image has no Node for the simulator): a simulation Tag, two
// internal Tags (one kept through a power cut), two calculated ones, and a logging group; the armhf
// smoke (deployment/toolchain/smoke-armhf.sh, feature 006 T181) loads it under qemu-user.
base(
  'smoke-armhf',
  'driver-it-smoke',
  null,
  [
    {
      id: 'A.WAVE',
      kind: 'simulation',
      type: 'FLOAT64',
      sim: { kind: 'ramp', from: 0, to: 100, periodMs: 10000 },
    },
    {
      id: 'I.SET',
      kind: 'internal',
      type: 'FLOAT32',
      access: 'RW',
      initial: 5,
      retain: true,
      limits: { min: 0, max: 100 },
    },
    {
      id: 'I.OTHER',
      kind: 'internal',
      type: 'FLOAT32',
      access: 'RW',
      initial: 1,
      limits: { min: 0, max: 100 },
    },
    { id: 'C.DOUBLE', kind: 'calculated', type: 'FLOAT32', expression: 'I.SET * 2' },
    { id: 'C.PLUS', kind: 'calculated', type: 'FLOAT32', expression: 'I.SET + I.OTHER' },
  ],
  {
    project: { loggingFile: 'logging.json' },
    logging: {
      schemaVersion: '0.2.0',
      groups: [
        {
          id: 'smoke',
          name: 'Smoke',
          mode: 'onChange',
          minIntervalMs: 1000,
          retentionDays: 7,
          tags: [{ tagId: 'C.DOUBLE' }, { tagId: 'I.SET' }, { tagId: 'C.PLUS' }],
        },
      ],
    },
  },
);
console.log('projects written');
