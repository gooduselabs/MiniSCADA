// Project of the logic integration tests (feature 011 T146; SC-025 to SC-028), format 1.0: Tags on
// the Modbus simulator of tools/modbus-sim (map tools/modbus-sim/maps/logic-it.json, host `sim`,
// port 1502, unit 1) and a logic.json with every kind of block:
//   pump_low / pump_high  LEVEL (HR0) < 20 / > 80 for 1 s: write PUMP.CMD (coil 10) true / false
//                         through writes[w_pump] (minIntervalMs 1000, maxPerHour 600)
//   fast_toggle           TRIG (coil 1) rising edge: write FAST.CMD (coil 11) = true, falling: false,
//                         through writes[w_fast] (minIntervalMs 5000, maxPerHour 6): the throttle
//   c_run                 counter of the rising edges of RUN (coil 0), retained
//   z_flow                totalizer of FLOW (HR1, per hour), retained
//   h_run                 run hours of RUN, retained
//   t_run                 TON of RUN, 2 s
// Deterministic: running it again gives the same bytes.
//   node tests/logic-it/make-project.mjs        (writes tests/logic-it/projects/logic-it/)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'projects/logic-it');
const V = '1.0.0';
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  ...extra,
  source: { device: 'd1', address, scanGroup: 'fast' },
});

const tags = {
  schemaVersion: V,
  tags: [
    ext('LEVEL', 'INT16', 'HR0', { unit: '%' }),
    ext('FLOW', 'INT16', 'HR1', { unit: 'm3/h' }),
    ext('RUN', 'BOOL', 'C0'),
    ext('TRIG', 'BOOL', 'C1'),
    ext('PUMP.CMD', 'BOOL', 'C10', { access: 'RW' }),
    ext('FAST.CMD', 'BOOL', 'C11', { access: 'RW' }),
  ],
};

const connections = {
  schemaVersion: V,
  scanGroups: { fast: 250, normal: 1000, slow: 5000 },
  channels: [
    {
      id: 'plc1',
      name: 'Giả lập Modbus',
      kind: 'modbus-tcp',
      tcp: { host: 'sim', port: 1502, connectTimeoutMs: 1000, reconnectMaxS: 4 },
      devices: [{ id: 'd1', name: 'PLC giả lập', unitId: 1, timeoutMs: 200 }],
    },
  ],
};

const logic = {
  schemaVersion: V,
  writes: [
    {
      id: 'w_pump',
      tag: 'PUMP.CMD',
      allowed: { values: [true, false] },
      minIntervalMs: 1000,
      maxPerHour: 600,
    },
    {
      id: 'w_fast',
      tag: 'FAST.CMD',
      allowed: { values: [true, false] },
      minIntervalMs: 5000,
      maxPerHour: 6,
    },
  ],
  rules: [
    {
      id: 'pump_low',
      name: 'Bơm tự bật khi mức thấp',
      when: 'LEVEL < 20',
      hold: 1000,
      onRise: [{ do: 'write', write: 'w_pump', value: true }],
    },
    {
      id: 'pump_high',
      name: 'Bơm tự tắt khi mức cao',
      when: 'LEVEL > 80',
      hold: 1000,
      onRise: [{ do: 'write', write: 'w_pump', value: false }],
    },
    {
      id: 'fast_toggle',
      name: 'Bật tắt nhanh (giới hạn tần suất)',
      when: 'TRIG',
      onRise: [{ do: 'write', write: 'w_fast', value: true }],
      onFall: [{ do: 'write', write: 'w_fast', value: false }],
    },
  ],
  timers: [{ id: 't_run', kind: 'ton', in: 'RUN', pt: 2000, q: 'LOGIC.T_RUN.Q', et: 'LOGIC.T_RUN.ET' }],
  counters: [
    {
      id: 'c_run',
      up: 'RUN',
      preset: 1000000,
      value: 'LOGIC.C_RUN.VALUE',
      reached: 'LOGIC.C_RUN.REACHED',
      retain: true,
    },
  ],
  totalizers: [
    {
      id: 'z_flow',
      source: 'FLOW',
      rateUnit: 'h',
      maxGapMs: 5000,
      total: 'LOGIC.Z_FLOW.TOTAL',
      gapSeconds: 'LOGIC.Z_FLOW.GAP_S',
      retain: true,
    },
  ],
  runhours: [
    {
      id: 'h_run',
      run: 'RUN',
      hours: 'LOGIC.H_RUN.HOURS',
      starts: 'LOGIC.H_RUN.STARTS',
      retain: true,
    },
  ],
};

const screen = {
  schemaVersion: V,
  id: 'tong-quan',
  name: 'Logic IT',
  size: { width: 1280, height: 720 },
  items: [
    {
      id: 'muc',
      name: 'muc',
      type: 'widget',
      widget: 'card',
      x: 20,
      y: 20,
      width: 200,
      height: 90,
      props: { label: 'Mức' },
      tags: { value: 'LEVEL' },
    },
    {
      id: 'dem',
      name: 'dem',
      type: 'widget',
      widget: 'card',
      x: 240,
      y: 20,
      width: 200,
      height: 90,
      props: { label: 'Số lần chạy' },
      tags: { value: 'LOGIC.C_RUN.VALUE' },
    },
  ],
};

const project = {
  format: 'matscada-project',
  schemaVersion: V,
  projectId: 'logic-it',
  projectName: 'Kiểm thử logic',
  projectVersion: '0.1.0',
  minRuntimeVersion: '1.0.0',
  entryScreen: 'tong-quan',
  screens: ['tong-quan'],
  tagFile: 'tags.json',
  connectionFile: 'connections.json',
  navigation: { position: 'left', items: [{ label: 'Logic', screen: 'tong-quan', icon: 'home' }] },
  maxClients: 10,
  logic: 'logic.json',
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'screens'), { recursive: true });
writeFileSync(join(out, 'project.json'), json(project));
writeFileSync(join(out, 'tags.json'), json(tags));
writeFileSync(join(out, 'connections.json'), json(connections));
writeFileSync(join(out, 'logic.json'), json(logic));
writeFileSync(join(out, 'screens/tong-quan.screen.json'), json(screen));
console.log(`logic-it project -> ${out}`);
