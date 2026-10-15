// Sinh hai project mẫu của feature 009 (định dạng 0.5.0; specs/009-alarms/quickstart.md):
//   node tools/alarm-demo/index.mjs [--out <thư mục gốc>]     (mặc định: projects/)
//   projects/alarm-demo  12 alarm: 4 số, 5 ngưỡng (HH/H/L/LL), 3 quality (một theo `device`); 4 lớp, 3 khu vực
//   projects/alarm-200   200 instance: 60 số, 100 ngưỡng, 40 quality (SC-001, SC-002, SC-011)
// Tag mô phỏng tất định của 006 (sine, ramp, random, square), cộng một thiết bị Modbus để alarm quality theo `device`.
// Đầu ra được commit; chạy lại cho cùng từng byte (test: generate.test.mjs).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_FORMAT_ALARMS,
  formatAlarmClassesFile,
  formatAlarmsFile,
  formatProject03,
  formatScreen03,
  formatTagsFile,
} from '@mat/project-schema';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const V = PROJECT_FORMAT_ALARMS;
const MIN_RUNTIME = '0.8.0';

const outFlag = process.argv.indexOf('--out');
if (outFlag >= 0 && !process.argv[outFlag + 1]) {
  console.error('Dùng: node tools/alarm-demo/index.mjs [--out <thư mục gốc>]');
  process.exit(2);
}
const outRoot = resolve(outFlag >= 0 ? process.argv[outFlag + 1] : join(root, 'projects'));

const pad = (i, w = 3) => String(i).padStart(w, '0');
const j2 = (v) => JSON.stringify(v, null, 2) + '\n';

const CLASSES = {
  schemaVersion: V,
  classes: [
    {
      id: 'critical',
      name: 'Khẩn cấp',
      priority: 'critical',
      color: 'red',
      blink: true,
      sound: 'siren',
    },
    {
      id: 'major',
      name: 'Quan trọng',
      priority: 'major',
      color: 'orange',
      blink: true,
      sound: 'double',
    },
    { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'beep' },
    { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', requiresAck: false },
  ],
};

const CONNECTIONS = {
  schemaVersion: V,
  scanGroups: { fast: 250, normal: 1000, slow: 5000 },
  channels: [
    {
      id: 'plc1',
      name: 'Giả lập Modbus',
      kind: 'modbus-tcp',
      tcp: { host: '127.0.0.1', port: 1502 },
      devices: [{ id: 'plc1', name: 'PLC giả lập', unitId: 1, byteOrder: 'ABCD' }],
    },
  ],
};

const sim = (id, type, simCfg, more = {}) => ({
  id,
  kind: 'simulation',
  type,
  ...more,
  sim: simCfg,
});
const ext = (id, type, address, more = {}) => ({
  id,
  kind: 'external',
  type,
  ...more,
  source: { device: 'plc1', address },
});

/** Màn hình tối thiểu (một thẻ giá trị) để project có màn hình vào. */
function screen(tagId, label) {
  return {
    schemaVersion: V,
    id: 'tong-quan',
    name: 'Tổng quan',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [
      {
        id: 'card_1',
        type: 'widget',
        widget: 'card',
        x: 40,
        y: 40,
        width: 280,
        height: 120,
        props: { label },
        tags: { value: tagId },
      },
    ],
  };
}

function projectJson(id, name) {
  return {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: id,
    projectName: name,
    projectVersion: '0.1.0',
    minRuntimeVersion: MIN_RUNTIME,
    entryScreen: 'tong-quan',
    screens: ['tong-quan'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    alarmFile: 'alarms.json',
    alarmClassFile: 'alarm-classes.json',
    navigation: {
      position: 'left',
      items: [{ label: 'Tổng quan', screen: 'tong-quan', icon: 'home' }],
    },
    maxClients: 10,
  };
}

// ---------------- alarm-demo ----------------
function demo() {
  const tags = [
    sim(
      'TANK1.LEVEL',
      'FLOAT32',
      { kind: 'sine', center: 50, amplitude: 48, periodMs: 60000 },
      { unit: '%', min: 0, max: 100 },
    ),
    sim(
      'TANK2.LEVEL',
      'FLOAT32',
      { kind: 'ramp', from: 20, to: 95, periodMs: 90000 },
      { unit: '%', min: 0, max: 100 },
    ),
    sim(
      'LINE.PRESS',
      'FLOAT32',
      { kind: 'random', min: 2, max: 9, periodMs: 2000, seed: 7 },
      { unit: 'bar', min: 0, max: 10 },
    ),
    sim(
      'BOILER.TEMP',
      'FLOAT32',
      { kind: 'sine', center: 60, amplitude: 50, periodMs: 45000 },
      { unit: '°C', min: -20, max: 140 },
    ),
    sim(
      'LINE.FLOW',
      'FLOAT32',
      { kind: 'ramp', from: 0, to: 120, periodMs: 120000 },
      { unit: 'm3/h', min: 0, max: 120 },
    ),
    sim('PUMP1.FAULT', 'BOOL', { kind: 'square', periodMs: 40000, duty: 0.2 }),
    sim('PUMP2.FAULT', 'BOOL', { kind: 'square', periodMs: 55000, duty: 0.15 }),
    sim('DOOR.OPEN', 'BOOL', { kind: 'square', periodMs: 30000, duty: 0.4 }),
    sim('ESTOP.OK', 'BOOL', { kind: 'square', periodMs: 70000, duty: 0.9 }),
    ext('PLC1.HEARTBEAT', 'UINT16', 'HR0'),
    ext('PLC1.TEMP_IN', 'FLOAT32', 'HR10', { unit: '°C' }),
    sim('SIM.SIGNAL', 'FLOAT32', { kind: 'sine', center: 5, amplitude: 4, periodMs: 20000 }),
  ];
  const lim = (id, name, area, tag, limits, extra = {}) => ({
    id,
    type: 'limit',
    name,
    area,
    tag,
    limits,
    ...extra,
  });
  const dig = (id, name, area, tag, trigger, cls, extra = {}) => ({
    id,
    type: 'digital',
    name,
    area,
    tag,
    trigger,
    class: cls,
    ...extra,
  });
  const alarms = {
    schemaVersion: V,
    areas: [
      { id: 'bon', name: 'Bồn' },
      { id: 'bom', name: 'Bơm' },
      { id: 'ket-noi', name: 'Kết nối' },
    ],
    alarms: [
      lim(
        'TANK1_LEVEL',
        'Mức bồn 1',
        'bon',
        'TANK1.LEVEL',
        {
          LL: { value: 5, class: 'major' },
          L: { value: 15, class: 'minor' },
          H: { value: 80, class: 'minor' },
          HH: {
            value: 92,
            class: 'critical',
            text: '{name} rất cao: {value:1} {unit} (> {limit})',
          },
        },
        { deadband: 2, onDelayMs: 1000, offDelayMs: 1000 },
      ),
      lim(
        'TANK2_LEVEL',
        'Mức bồn 2',
        'bon',
        'TANK2.LEVEL',
        { H: { value: 85, class: 'major' } },
        { deadband: 2 },
      ),
      lim(
        'LINE_PRESS',
        'Áp suất đường ống',
        'bom',
        'LINE.PRESS',
        {
          H: { value: 7.5, class: 'minor' },
          HH: { value: 8.5, class: 'critical' },
        },
        { deadband: 0.2, onDelayMs: 500 },
      ),
      lim(
        'BOILER_TEMP',
        'Nhiệt độ nồi hơi',
        'bom',
        'BOILER.TEMP',
        {
          L: { value: 20, class: 'advisory' },
          H: { value: 100, class: 'major' },
        },
        { deadband: 3, onDelayMs: 2000, offDelayMs: 2000 },
      ),
      lim(
        'LINE_FLOW',
        'Lưu lượng thấp',
        'bom',
        'LINE.FLOW',
        { LL: { value: 10, class: 'minor' } },
        { deadband: 1 },
      ),
      dig('PUMP1_FAULT', 'Bơm 1 lỗi', 'bom', 'PUMP1.FAULT', true, 'critical', {
        text: 'Bơm 1 báo lỗi ({tag})',
        onDelayMs: 500,
      }),
      dig('PUMP2_FAULT', 'Bơm 2 lỗi', 'bom', 'PUMP2.FAULT', true, 'major'),
      dig('DOOR_OPEN', 'Cửa tủ điện mở', 'ket-noi', 'DOOR.OPEN', true, 'advisory'),
      dig('ESTOP_NOT_OK', 'Dừng khẩn cấp', 'ket-noi', 'ESTOP.OK', false, 'critical', {
        offDelayMs: 1000,
      }),
      {
        id: 'PLC1_LINK',
        type: 'quality',
        name: 'Mất kết nối PLC1',
        area: 'ket-noi',
        device: 'plc1',
        class: 'major',
        text: '{name}: mất tín hiệu ({reason})',
        onDelayMs: 5000,
      },
      {
        id: 'PLC1_TEMP_SIGNAL',
        type: 'quality',
        name: 'Mất tín hiệu nhiệt PLC1',
        area: 'ket-noi',
        tag: 'PLC1.TEMP_IN',
        on: 'notGood',
        class: 'minor',
      },
      {
        id: 'SIM_SIGNAL',
        type: 'quality',
        name: 'Tín hiệu mô phỏng xấu',
        area: 'ket-noi',
        tag: 'SIM.SIGNAL',
        class: 'advisory',
      },
    ],
  };
  return {
    name: 'alarm-demo',
    files: {
      'project.json': formatProject03(projectJson('alarm-demo', 'Demo alarm ISA-18.2')),
      'tags.json': formatTagsFile({ schemaVersion: V, tags }),
      'connections.json': j2(CONNECTIONS),
      'alarms.json': formatAlarmsFile(alarms),
      'alarm-classes.json': formatAlarmClassesFile(CLASSES),
      'screens/tong-quan.screen.json': formatScreen03(screen('TANK1.LEVEL', 'Mức bồn 1')),
    },
  };
}

// ---------------- alarm-200 ----------------
function large() {
  const tags = [ext('PLC1.HEARTBEAT', 'UINT16', 'HR0')];
  const alarmList = [];
  const classOf = (i) => ['minor', 'major', 'critical', 'advisory'][i % 4];
  // 60 số
  for (let i = 1; i <= 60; i++) {
    const id = `DIG.${pad(i)}`;
    tags.push(
      sim(id, 'BOOL', { kind: 'square', periodMs: 20000 + i * 1000, duty: 0.1 + (i % 5) * 0.1 }),
    );
    alarmList.push({
      id: `DIG_${pad(i)}`,
      type: 'digital',
      name: `Số ${i}`,
      area: `a${pad((i % 8) + 1, 2)}`,
      tag: id,
      trigger: i % 7 !== 0,
      class: classOf(i),
      onDelayMs: (i % 3) * 500,
    });
  }
  // 100 ngưỡng: 50 alarm x (H, HH)
  for (let i = 1; i <= 50; i++) {
    const id = `ANA.${pad(i)}`;
    tags.push(
      sim(
        id,
        'FLOAT32',
        { kind: 'sine', center: 50, amplitude: 49, periodMs: 30000 + i * 1500 },
        { min: 0, max: 100, unit: '%' },
      ),
    );
    alarmList.push({
      id: `ANA_${pad(i)}`,
      type: 'limit',
      name: `Tương tự ${i}`,
      area: `a${pad((i % 8) + 1, 2)}`,
      tag: id,
      limits: { H: { value: 80, class: 'minor' }, HH: { value: 92, class: 'critical' } },
      deadband: 2,
      onDelayMs: 1000,
      offDelayMs: 1000,
    });
  }
  // 40 quality: 30 theo Tag, 10 theo thiết bị
  for (let i = 1; i <= 30; i++)
    alarmList.push({
      id: `QTAG_${pad(i)}`,
      type: 'quality',
      name: `Chất lượng Tag ${i}`,
      area: `a${pad((i % 8) + 1, 2)}`,
      tag: `ANA.${pad(i)}`,
      class: 'advisory',
    });
  for (let i = 1; i <= 10; i++)
    alarmList.push({
      id: `QDEV_${pad(i)}`,
      type: 'quality',
      name: `Mất thiết bị ${i}`,
      area: `a${pad((i % 8) + 1, 2)}`,
      device: 'plc1',
      class: 'major',
      onDelayMs: 5000,
    });
  const areas = [];
  for (let i = 1; i <= 8; i++) areas.push({ id: `a${pad(i, 2)}`, name: `Khu ${i}` });
  return {
    name: 'alarm-200',
    files: {
      'project.json': formatProject03(projectJson('alarm-200', 'Alarm 200 instance')),
      'tags.json': formatTagsFile({ schemaVersion: V, tags }),
      'connections.json': j2(CONNECTIONS),
      'alarms.json': formatAlarmsFile({ schemaVersion: V, areas, alarms: alarmList }),
      'alarm-classes.json': formatAlarmClassesFile(CLASSES),
      'screens/tong-quan.screen.json': formatScreen03(screen('ANA.001', 'Tương tự 1')),
    },
  };
}

for (const p of [demo(), large()]) {
  const dir = join(outRoot, p.name);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(p.files)) {
    const f = join(dir, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  console.log(`${p.name}: ${Object.keys(p.files).length} file trong ${dir}`);
}
