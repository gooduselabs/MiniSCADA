// Project mẫu 0.3 cho e2e của trang vận hành (feature 007, T040, T074): 5 màn hình (tong-quan, bom1, bon-nuoc, hong,
// popup pop-bom) dùng widget hiển thị, widget điều khiển, một item `svg` (đồ họa của projects/tank-demo) và điều
// hướng nhóm. Dùng tạm cho tới khi có projects/dashboard-demo (S1); tên Tag giữ theo tank-demo cho phần đồ họa.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TANK = resolve(here, '../../../../projects/tank-demo');

const tag = (id, type, extra = {}) => ({ id, type, kind: 'external', access: 'R', ...extra });

export const TAGS = [
  tag('TANK01.LEVEL', 'FLOAT32', { description: 'Mức nước bồn', unit: '%', min: 0, max: 100 }),
  tag('TANK01.INFLOW', 'FLOAT32', { description: 'Lưu lượng vào', unit: 'm3/h', min: 0, max: 20 }),
  tag('TANK01.TEMP', 'FLOAT32', { description: 'Nhiệt độ', unit: '°C', min: 0, max: 100 }),
  tag('MOTOR01.RUN', 'BOOL', { description: 'Bơm đang chạy' }),
  tag('MOTOR01.SPEED', 'FLOAT32', { description: 'Tốc độ bơm', unit: 'rpm', min: 0, max: 1500 }),
  tag('GHOST.TAG', 'FLOAT32', { description: 'Tag thiết bị không biết' }),
  tag('PUMP1.RUN_CMD', 'BOOL', {
    access: 'RW',
    description: 'Lệnh chạy bơm 1',
    source: { device: 'plc1', address: 'C1' },
  }),
  tag('PUMP1.START_CMD', 'BOOL', {
    access: 'RW',
    description: 'Xung khởi động bơm 1',
    source: { device: 'plc1', address: 'C2' },
  }),
  tag('PUMP1.AUTO', 'BOOL', {
    access: 'RW',
    description: 'Chế độ tự động bơm 1',
    source: { device: 'plc1', address: 'C3' },
  }),
  tag('TANK01.SP', 'FLOAT32', {
    access: 'RW',
    unit: '%',
    limits: { min: 0, max: 100 },
    description: 'Đặt mức bồn',
    source: { device: 'plc1', address: 'HR1' },
  }),
  tag('PUMP1.SPEED_SP', 'FLOAT32', {
    access: 'RW',
    unit: 'rpm',
    limits: { min: 0, max: 1500 },
    description: 'Đặt tốc độ bơm',
    source: { device: 'plc1', address: 'HR2' },
  }),
  tag('PUMP1.MODE', 'INT16', {
    access: 'RW',
    valueTable: 'ChedoBom',
    description: 'Chế độ bơm',
    source: { device: 'plc1', address: 'HR3' },
  }),
  tag('VALVE1.CMD', 'BOOL', {
    access: 'RW',
    description: 'Lệnh van 1',
    source: { device: 'plc1', address: 'C4' },
  }),
  tag('TANK02.SP', 'FLOAT32', {
    access: 'RW',
    limits: { min: 0, max: 100 },
    description: 'Đặt mức bồn 2',
    source: { device: 'plc1', address: 'HR4' },
  }),
  tag('TANK03.SP', 'FLOAT32', {
    access: 'RW',
    limits: { min: 0, max: 100 },
    description: 'Đặt mức bồn 3',
    source: { device: 'plc1', address: 'HR5' },
  }),
];

export const VALUE_TABLES = {
  ChedoBom: {
    schemaVersion: '0.3.0',
    name: 'ChedoBom',
    entries: [
      { value: 0, text: 'Tắt' },
      { value: 1, text: 'Chạy tay' },
      { value: 2, text: 'Tự động' },
    ],
  },
};

const w = (id, widget, x, y, width, height, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  x,
  y,
  width,
  height,
  ...extra,
});

const screens = {
  'tong-quan': {
    schemaVersion: '0.3.0',
    id: 'tong-quan',
    name: 'Tổng quan',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [
      w('pnl', 'panel', 20, 20, 560, 330, { props: { title: 'Bồn nước' } }),
      w('lvl', 'card', 40, 70, 220, 110, {
        props: { label: 'Mức bồn', decimals: 1 },
        tags: { value: 'TANK01.LEVEL' },
      }),
      w('gg', 'gauge', 290, 60, 270, 220, {
        props: { label: 'Mức', zones: [{ from: 0, to: 20, color: '#c42b2b' }] },
        tags: { value: 'TANK01.LEVEL' },
      }),
      w('lp', 'lamp', 40, 200, 200, 40, {
        props: { label: 'Bơm 1' },
        tags: { state: 'MOTOR01.RUN' },
      }),
      w('tmp', 'card', 40, 260, 220, 80, {
        props: { label: 'Nhiệt độ' },
        tags: { value: 'TANK01.TEMP' },
      }),
      w('ghost', 'card', 600, 70, 220, 110, {
        props: { label: 'Tag lạ' },
        tags: { value: 'GHOST.TAG' },
      }),
      w('xss', 'label', 600, 200, 400, 40, {
        props: { text: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>' },
      }),
      w('go', 'button', 600, 270, 200, 48, {
        props: { label: 'Mở màn hình Bơm', variant: 'neutral' },
        events: { click: { action: 'navigate', screen: 'bom1' } },
      }),
      w('pop', 'button', 820, 270, 200, 48, {
        props: { label: 'Mở cửa sổ bơm', variant: 'neutral' },
        events: { click: { action: 'popup', screen: 'pop-bom' } },
      }),
    ],
  },
  bom1: {
    schemaVersion: '0.3.0',
    id: 'bom1',
    name: 'Bơm 1',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [
      w('run', 'button', 40, 40, 200, 48, {
        props: { label: 'Chạy bơm', variant: 'primary' },
        tags: { target: 'PUMP1.RUN_CMD' },
        events: { click: { action: 'write', value: true } },
      }),
      w('start', 'button', 260, 40, 200, 48, {
        props: { label: 'Xung khởi động', variant: 'primary' },
        tags: { target: 'PUMP1.START_CMD' },
        events: { click: { action: 'pulse', value: true, durationMs: 500 } },
      }),
      w('auto', 'switch', 480, 40, 200, 48, {
        props: { label: 'Tự động' },
        tags: { target: 'PUMP1.AUTO' },
      }),
      w('sp', 'setpoint', 40, 120, 240, 72, {
        props: { label: 'Mức đặt', decimals: 1 },
        tags: { target: 'TANK01.SP' },
      }),
      w('spd', 'slider', 300, 120, 320, 64, {
        props: { label: 'Tốc độ đặt', step: 10 },
        tags: { target: 'PUMP1.SPEED_SP' },
      }),
      w('mode', 'select', 640, 120, 240, 72, {
        props: { label: 'Chế độ' },
        tags: { target: 'PUMP1.MODE' },
      }),
      w('valve', 'button', 40, 240, 200, 48, {
        props: { label: 'Mở van', variant: 'danger' },
        tags: { target: 'VALVE1.CMD' },
        events: { click: { action: 'write', value: true } },
      }),
      w('sp2', 'setpoint', 260, 240, 240, 72, {
        props: { label: 'Mức bồn 2' },
        tags: { target: 'TANK02.SP' },
      }),
      w('sp3', 'setpoint', 520, 240, 240, 72, {
        props: { label: 'Mức bồn 3' },
        tags: { target: 'TANK03.SP' },
      }),
      w('xssbtn', 'button', 40, 340, 260, 48, {
        props: { label: 'Nút XSS', confirmText: '<img src=x onerror="window.__xss=1">Xác nhận?' },
        tags: { target: 'PUMP1.RUN_CMD' },
        events: { click: { action: 'write', value: true } },
      }),
      w('lvl', 'card', 40, 420, 220, 110, {
        props: { label: 'Mức bồn' },
        tags: { value: 'TANK01.LEVEL' },
      }),
      w('spd_show', 'card', 280, 420, 220, 110, {
        props: { label: 'Tốc độ' },
        tags: { value: 'MOTOR01.SPEED' },
      }),
      w('back', 'button', 1040, 40, 200, 48, {
        props: { label: 'Về Tổng quan', variant: 'neutral' },
        events: { click: { action: 'navigate', screen: 'tong-quan' } },
      }),
    ],
  },
  'bon-nuoc': {
    schemaVersion: '0.3.0',
    id: 'bon-nuoc',
    name: 'Bồn nước',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    background: '#0f172a',
    items: [
      {
        id: 'svg1',
        name: 'Đồ họa',
        type: 'svg',
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        svgFile: 'screens/tank-motor.svg',
        bindingFile: 'screens/tank-motor.bindings.json',
        viewBox: [0, 0, 1280, 720],
        fit: 'contain',
        elements: [
          { elementUid: 'el_tank_level' },
          { elementUid: 'el_tank_body' },
          { elementUid: 'el_txt_level' },
          { elementUid: 'el_motor_body' },
          { elementUid: 'el_motor_fan' },
          { elementUid: 'el_motor_lamp' },
          { elementUid: 'el_txt_speed' },
          { elementUid: 'el_txt_temp' },
        ],
      },
    ],
  },
  hong: {
    schemaVersion: '0.3.0',
    id: 'hong',
    name: 'Màn hình hỏng',
    kind: 'screen',
    size: { width: 800, height: 600 },
    items: [],
  },
  'pop-bom': {
    schemaVersion: '0.3.0',
    id: 'pop-bom',
    name: 'Bơm (cửa sổ)',
    kind: 'popup',
    size: { width: 420, height: 260 },
    items: [
      w('t', 'label', 20, 20, 380, 40, { props: { text: 'Cửa sổ bơm 1', bold: true } }),
      w('v', 'card', 20, 80, 200, 100, {
        props: { label: 'Tốc độ' },
        tags: { value: 'MOTOR01.SPEED' },
      }),
      w('close', 'button', 240, 100, 160, 48, {
        props: { label: 'Đóng', variant: 'neutral' },
        events: { click: { action: 'closePopup' } },
      }),
    ],
  },
};

const navigation = {
  position: 'left',
  items: [
    { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
    {
      label: 'Giám sát',
      items: [
        { label: 'Bơm 1', screen: 'bom1', icon: 'pump' },
        { label: 'Bồn nước', screen: 'bon-nuoc', icon: 'tank' },
      ],
    },
    { label: 'Màn hình hỏng', screen: 'hong', icon: 'doc' },
  ],
};

/** Mô hình project 0.3 như `GET /api/v1/projects/active` (tóm tắt) và các file `/project/…`. */
export function dashboard() {
  const files = new Map();
  const summary = [];
  for (const s of Object.values(screens)) {
    const file = `screens/${s.id}.screen.json`;
    files.set(file, { json: s });
    summary.push({ id: s.id, name: s.name, kind: s.kind, file });
  }
  files.set('screens/tank-motor.svg', {
    text: readFileSync(resolve(TANK, 'screens/tank-motor.svg'), 'utf8'),
    type: 'image/svg+xml',
  });
  files.set('screens/tank-motor.bindings.json', {
    text: readFileSync(resolve(TANK, 'screens/tank-motor.bindings.json'), 'utf8'),
  });
  return {
    active: {
      project: {
        format: 'matscada-project',
        schemaVersion: '0.3.0',
        projectId: 'dashboard-e2e',
        projectName: 'Trạm bơm e2e',
        projectVersion: '1.0.0',
        entryScreen: 'tong-quan',
        navigation,
      },
      tags: { schemaVersion: '0.3.0', tags: TAGS },
      valueTables: VALUE_TABLES,
      connections: [{ id: 'plc1', name: 'PLC trạm bơm', kind: 'modbus-tcp' }],
      navigation,
      screens: summary,
      digest: 'sha256:e2e-dashboard',
    },
    files,
  };
}

/** Project 0.1 (projects/tank-demo): thân đầy đủ như runtime 0.5 (bản đồ màn hình), để thử tương thích. */
export function legacyTank() {
  const read = (p) => readFileSync(resolve(TANK, p), 'utf8');
  const screen = JSON.parse(read('screens/tank-motor.screen.json'));
  const bindings = JSON.parse(read('screens/tank-motor.bindings.json'));
  const project = JSON.parse(read('project.json'));
  const tags = JSON.parse(read('tags.json'));
  const files = new Map([
    ['screens/tank-motor.svg', { text: read('screens/tank-motor.svg'), type: 'image/svg+xml' }],
  ]);
  return {
    active: {
      project,
      tags,
      screens: { 'tank-motor': { screen, bindings } },
      digest: 'sha256:e2e-tank',
    },
    files,
  };
}

/**
 * Project 0.3 cho e2e widget alarm (feature 009, T103): màn hình "Bảng alarm" có 20 widget thường cộng `alarm-list` và hai
 * `alarm-count` (đích trang Alarm và đích màn hình "Tổng quan"), cộng một màn hình thứ hai để có menu.
 */
export function alarmBoard() {
  const base = dashboard();
  const cards = Array.from({ length: 20 }, (_, i) =>
    w(`c${i}`, 'card', 20 + (i % 5) * 230, 20 + Math.floor(i / 5) * 90, 220, 80, {
      props: { label: `Thẻ ${i + 1}` },
      tags: { value: i % 2 ? 'TANK01.LEVEL' : 'MOTOR01.SPEED' },
    }),
  );
  const board = {
    schemaVersion: '0.3.0',
    id: 'bang-alarm',
    name: 'Bảng alarm',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [
      ...cards,
      w('al', 'alarm-list', 20, 400, 760, 280, {
        props: {
          areas: ['bon'],
          minPriority: 'minor',
          columns: ['time', 'priority', 'text', 'state'],
          maxRows: 5,
          showAck: true,
        },
      }),
      w('cnt', 'alarm-count', 820, 400, 120, 60, { props: { mode: 'unacked' } }),
      w('cnt2', 'alarm-count', 960, 400, 120, 60, {
        props: { mode: 'active', target: { kind: 'screen', screen: 'tong-quan' } },
      }),
    ],
  };
  const nav = {
    position: 'left',
    items: [
      { label: 'Bảng alarm', screen: 'bang-alarm', icon: 'bell' },
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
    ],
  };
  base.files.set('screens/bang-alarm.screen.json', { json: board });
  const summary = [
    {
      id: 'bang-alarm',
      name: 'Bảng alarm',
      kind: 'screen',
      file: 'screens/bang-alarm.screen.json',
    },
    { id: 'tong-quan', name: 'Tổng quan', kind: 'screen', file: 'screens/tong-quan.screen.json' },
  ];
  return {
    active: {
      ...base.active,
      project: {
        ...base.active.project,
        projectId: 'alarm-board-e2e',
        entryScreen: 'bang-alarm',
        navigation: nav,
      },
      navigation: nav,
      screens: summary,
      digest: 'sha256:e2e-alarm-board',
    },
    files: base.files,
  };
}
