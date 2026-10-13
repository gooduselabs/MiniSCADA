// Sinh project mẫu `projects/dashboard-demo` (0.3.0; specs/007-screens-widgets/quickstart.md §0):
//   node tools/dashboard-demo/generate.mjs [--out <thư mục>]
// 4 màn hình: Tổng quan (1 item svg + 26 widget, đủ 15 loại), Bồn nước, Giám sát (biểu đồ, bảng Tag), popup Bơm 1;
// menu điều hướng bên trái. Tag, kết nối, bảng giá trị chép từ `projects/modbus-demo` (đổi schemaVersion), cộng Tag
// mô phỏng tất định (SIM.*). Đầu ra được commit; chạy lại cho cùng từng byte (test: generate.test.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProject03, formatScreen03, formatTagsFile } from '@mat/project-schema';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const V = '0.3.0';

const outFlag = process.argv.indexOf('--out');
const outDir = resolve(
  outFlag >= 0 ? (process.argv[outFlag + 1] ?? '') : join(root, 'projects/dashboard-demo'),
);
if (outFlag >= 0 && !process.argv[outFlag + 1]) {
  console.error('Dùng: node tools/dashboard-demo/generate.mjs [--out <thư mục>]');
  process.exit(2);
}

const src = (rel) => readFileSync(join(root, 'projects/modbus-demo', rel), 'utf8');
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
/** Chép tệp 0.2 sang 0.3: chỉ đổi `schemaVersion`, giữ từng byte còn lại. */
const to03 = (text) => text.replace(/("schemaVersion"\s*:\s*")0\.2\.\d+(")/, `$1${V}$2`);

// ---------------- Tag: của modbus-demo + Tag mô phỏng tất định ----------------
const modbusTags = JSON.parse(stripBom(src('tags.json'))).tags;
const simTags = [
  {
    id: 'SIM.TEMP',
    kind: 'simulation',
    type: 'FLOAT32',
    description: 'Nhiệt độ nước (mô phỏng)',
    unit: '°C',
    min: 0,
    max: 100,
    sim: { kind: 'sine', center: 45, amplitude: 20, periodMs: 30000 },
  },
  {
    id: 'SIM.PRESS',
    kind: 'simulation',
    type: 'FLOAT32',
    description: 'Áp suất đường ống (mô phỏng)',
    unit: 'bar',
    min: 0,
    max: 10,
    sim: { kind: 'random', min: 2, max: 6, periodMs: 2000, seed: 7 },
  },
  {
    id: 'SIM.FLOW',
    kind: 'simulation',
    type: 'FLOAT32',
    description: 'Lưu lượng (mô phỏng)',
    unit: 'm3/h',
    min: 0,
    max: 120,
    sim: { kind: 'ramp', from: 10, to: 100, periodMs: 60000 },
  },
  {
    id: 'SIM.ALARM',
    kind: 'simulation',
    type: 'BOOL',
    description: 'Cảnh báo luân phiên (mô phỏng)',
    sim: { kind: 'square', periodMs: 8000 },
  },
  {
    id: 'SIM.MODE',
    kind: 'simulation',
    type: 'INT16',
    description: 'Chế độ chạy (nhập tay)',
    access: 'RW',
    limits: { min: 0, max: 2 },
    valueTable: 'TrangThaiBom',
    sim: { kind: 'manual', initial: 0 },
  },
  {
    id: 'SIM.SP_FLOW',
    kind: 'simulation',
    type: 'FLOAT32',
    description: 'Lưu lượng đặt (nhập tay)',
    unit: 'm3/h',
    access: 'RW',
    limits: { min: 0, max: 120 },
    sim: { kind: 'manual', initial: 50 },
  },
  {
    id: 'SIM.FAN_ON',
    kind: 'simulation',
    type: 'BOOL',
    description: 'Quạt làm mát (nhập tay)',
    access: 'RW',
    sim: { kind: 'manual', initial: false },
  },
];
const tagsText = formatTagsFile({ schemaVersion: V, tags: [...modbusTags, ...simTags] });

// ---------------- Trợ giúp dựng item ----------------
const widget = (id, name, kind, x, y, width, height, more = {}) => ({
  id,
  name,
  type: 'widget',
  widget: kind,
  x,
  y,
  width,
  height,
  ...more,
});
const screen = (id, name, size, items, more = {}) => ({
  schemaVersion: V,
  id,
  name,
  kind: 'screen',
  size,
  fitMode: 'contain',
  items,
  ...more,
});

// ---------------- Màn hình 1: Tổng quan (1920 x 1080) ----------------
const overview = screen('tong-quan', 'Tổng quan', { width: 1920, height: 1080 }, [
  widget('panel_hdr', 'Khung tiêu đề', 'panel', 0, 0, 1920, 80, {
    props: { title: 'Trạm bơm số 1' },
  }),
  widget('panel_tank', 'Khung bồn', 'panel', 40, 100, 600, 600, { props: { title: 'Bồn nước 1' } }),
  widget('panel_ctrl', 'Khung điều khiển', 'panel', 40, 720, 1840, 320, {
    props: { title: 'Điều khiển' },
  }),
  {
    id: 'svg1',
    name: 'Sơ đồ bồn và bơm',
    type: 'svg',
    x: 60,
    y: 160,
    width: 560,
    height: 520,
    svgFile: 'screens/tong-quan.svg',
    bindingFile: 'screens/tong-quan.bindings.json',
    viewBox: [0, 0, 520, 520],
    elements: [
      { elementUid: 'el_tank', name: 'Bồn' },
      { elementUid: 'el_pump', name: 'Bơm' },
      { elementUid: 'el_state', name: 'Trạng thái' },
    ],
  },
  widget('label_pump', 'Tên bơm', 'label', 660, 100, 260, 40, {
    props: { text: 'Bơm:', bold: true },
    tags: { value: 'PUMP01.NAME' },
  }),
  widget('label_state', 'Trạng thái bơm', 'label', 940, 100, 300, 40, {
    props: { text: 'Trạng thái:' },
    tags: { value: 'PUMP01.STATE_TEXT' },
  }),
  widget('level_tank', 'Mức bồn', 'level', 660, 160, 100, 260, {
    props: {
      label: 'Mức',
      zones: [
        { from: 0, to: 20, color: '#C62828' },
        { from: 20, to: 90, color: '#2E7D32' },
        { from: 90, to: 100, color: '#B26A00' },
      ],
    },
    tags: { value: 'TANK01.LEVEL' },
  }),
  widget('card_level', 'Mức nước', 'card', 780, 160, 220, 110, {
    props: { label: 'Mức nước', decimals: 1 },
    tags: { value: 'TANK01.LEVEL' },
  }),
  widget('card_volume', 'Thể tích', 'card', 780, 290, 220, 110, {
    props: { label: 'Thể tích', decimals: 0 },
    tags: { value: 'TANK01.VOLUME' },
  }),
  widget('card_power', 'Công suất', 'card', 1020, 160, 220, 110, {
    props: { label: 'Công suất bơm', decimals: 2, fontSize: 'l' },
    tags: { value: 'METER1.P' },
  }),
  widget('card_press', 'Áp suất', 'card', 1020, 290, 220, 110, {
    props: { label: 'Áp suất', decimals: 1 },
    tags: { value: 'SIM.PRESS' },
  }),
  widget('gauge_level', 'Đồng hồ mức', 'gauge', 1260, 100, 240, 200, {
    props: { label: 'Mức bồn' },
    tags: { value: 'TANK01.LEVEL' },
  }),
  widget('gauge_temp', 'Đồng hồ nhiệt độ', 'gauge', 1520, 100, 240, 200, {
    props: {
      label: 'Nhiệt độ',
      zones: [
        { from: 0, to: 60, color: '#2E7D32' },
        { from: 60, to: 80, color: '#B26A00' },
        { from: 80, to: 100, color: '#C62828' },
      ],
    },
    tags: { value: 'SIM.TEMP' },
  }),
  widget('lamp_fault', 'Đèn lỗi bơm', 'lamp', 660, 440, 220, 40, {
    props: { label: 'Lỗi bơm 1', onColor: '#C62828' },
    tags: { state: 'PUMP01.FAULT' },
  }),
  widget('lamp_high', 'Đèn mức cao', 'lamp', 660, 490, 220, 40, {
    props: { label: 'Mức cao', onColor: '#B26A00' },
    tags: { state: 'TANK01.HIGH' },
  }),
  widget('lamp_alarm', 'Đèn cảnh báo', 'lamp', 660, 540, 220, 40, {
    props: { label: 'Cảnh báo mô phỏng', shape: 'square', onColor: '#B26A00' },
    tags: { state: 'SIM.ALARM' },
  }),
  widget('line_trend', 'Xu hướng', 'line', 900, 320, 600, 280, {
    props: { windowSec: 120, labels: ['Mức', 'Mức đặt', 'Sóng thử'] },
    tags: { series: ['TANK01.LEVEL', 'TANK01.SP', 'DEMO.WAVE'] },
  }),
  widget('bar_flow', 'So sánh', 'bar', 1520, 320, 360, 260, {
    props: { labels: ['Công suất', 'Lưu lượng', 'Áp suất'] },
    tags: { series: ['METER1.P', 'SIM.FLOW', 'SIM.PRESS'] },
  }),
  widget('pie_share', 'Tỉ trọng', 'pie', 660, 590, 220, 120, {
    props: { labels: ['Lưu lượng', 'Nhiệt độ', 'Áp suất'], showPercent: false },
    tags: { series: ['SIM.FLOW', 'SIM.TEMP', 'SIM.PRESS'] },
  }),
  widget('table_tags', 'Bảng Tag', 'tag-table', 900, 610, 600, 90, {
    props: { dense: true },
    tags: { rows: ['TANK01.LEVEL', 'TANK01.SP', 'PUMP01.STATE'] },
  }),
  widget('btn_start', 'Chạy bơm', 'button', 60, 780, 180, 48, {
    props: { label: 'Chạy bơm (xung)', confirmText: 'Chạy bơm 1 trong 0,5 giây?' },
    tags: { target: 'PUMP01.RUN_CMD' },
    events: { click: { action: 'pulse', value: true, durationMs: 500 } },
  }),
  widget('btn_toggle', 'Đảo trạng thái', 'button', 260, 780, 180, 48, {
    props: { label: 'Đảo chạy/dừng', variant: 'danger' },
    tags: { target: 'R.RUN' },
    events: { click: { action: 'toggle' } },
    security: { minRole: 'engineer' },
  }),
  widget('btn_popup', 'Chi tiết bơm', 'button', 460, 780, 180, 48, {
    props: { label: 'Chi tiết bơm 1', variant: 'neutral' },
    events: { click: { action: 'popup', screen: 'bom1' } },
  }),
  widget('btn_goto', 'Tới giám sát', 'button', 660, 780, 180, 48, {
    props: { label: 'Giám sát', variant: 'neutral' },
    events: { click: { action: 'navigate', screen: 'giam-sat' } },
  }),
  widget('sw_pump', 'Công tắc bơm', 'switch', 60, 860, 200, 48, {
    props: { label: 'Bơm 1' },
    tags: { target: 'PUMP01.RUN_CMD' },
  }),
  widget('sw_fan', 'Quạt', 'switch', 280, 860, 200, 48, {
    props: { label: 'Quạt', onText: 'Chạy', offText: 'Dừng' },
    tags: { target: 'SIM.FAN_ON' },
  }),
  widget('sp_level', 'Mức đặt', 'setpoint', 520, 860, 240, 72, {
    props: { label: 'Mức đặt' },
    tags: { target: 'TANK01.SP' },
    security: { minRole: 'engineer' },
  }),
  widget('slider_flow', 'Lưu lượng đặt', 'slider', 800, 860, 320, 64, {
    props: { label: 'Lưu lượng đặt', step: 5, decimals: 0 },
    tags: { target: 'SIM.SP_FLOW' },
  }),
  widget('select_mode', 'Chế độ', 'select', 1160, 860, 240, 72, {
    props: { label: 'Chế độ chạy' },
    tags: { target: 'SIM.MODE' },
  }),
]);

// ---------------- Màn hình 2: Bồn nước (1280 x 720) ----------------
const tank = screen('bon-nuoc', 'Bồn nước', { width: 1280, height: 720 }, [
  widget('panel_a', 'Khung mức', 'panel', 40, 40, 360, 640, { props: { title: 'Mức bồn' } }),
  widget('level_a', 'Mức', 'level', 80, 100, 140, 540, {
    props: { label: 'Mức nước' },
    tags: { value: 'TANK01.LEVEL' },
  }),
  widget('card_a', 'Mức hiện tại', 'card', 240, 100, 140, 110, {
    props: { label: 'Hiện tại', fontSize: 'l' },
    tags: { value: 'TANK01.LEVEL' },
  }),
  widget('card_b', 'Thể tích', 'card', 240, 230, 140, 110, {
    props: { label: 'Thể tích', decimals: 0 },
    tags: { value: 'TANK01.VOLUME' },
  }),
  widget('card_c', 'Mức cao', 'card', 240, 360, 140, 110, {
    props: { label: 'Mức cao đặt', decimals: 0 },
    tags: { value: 'TANK01.SP_HI' },
  }),
  widget('panel_b', 'Khung đặt', 'panel', 420, 40, 820, 300, {
    props: { title: 'Đặt mức và ngưỡng' },
  }),
  widget('sp_main', 'Mức đặt', 'setpoint', 460, 100, 260, 72, {
    props: { label: 'Mức đặt' },
    tags: { target: 'TANK01.SP' },
    security: { minRole: 'engineer' },
  }),
  widget('sp_high', 'Ngưỡng mức cao', 'setpoint', 760, 100, 260, 72, {
    props: { label: 'Ngưỡng mức cao', decimals: 0 },
    tags: { target: 'TANK01.SP_HI' },
    security: { minRole: 'engineer' },
  }),
  widget('slider_sp', 'Kéo mức đặt', 'slider', 460, 200, 560, 64, {
    props: { label: 'Kéo mức đặt', decimals: 0 },
    tags: { target: 'TANK01.SP' },
  }),
  widget('lamp_h', 'Đèn mức cao', 'lamp', 1060, 100, 160, 40, {
    props: { label: 'Mức cao', onColor: '#B26A00' },
    tags: { state: 'TANK01.HIGH' },
  }),
  widget('trend_a', 'Xu hướng mức', 'line', 420, 360, 820, 320, {
    props: { windowSec: 300, yMin: 0, yMax: 100 },
    tags: { series: ['TANK01.LEVEL', 'TANK01.SP', 'TANK01.SP_HI'] },
  }),
]);

// ---------------- Màn hình 3: Giám sát (1920 x 1080) ----------------
const monitor = screen('giam-sat', 'Giám sát', { width: 1920, height: 1080 }, [
  widget('trend_main', 'Xu hướng chính', 'line', 40, 40, 1100, 480, {
    props: { windowSec: 600, sampleMs: 2000, labels: ['Mức', 'Nhiệt độ', 'Áp suất', 'Lưu lượng'] },
    tags: { series: ['TANK01.LEVEL', 'SIM.TEMP', 'SIM.PRESS', 'SIM.FLOW'] },
  }),
  widget('trend_fast', 'Xu hướng nhanh', 'line', 40, 540, 1100, 480, {
    props: { windowSec: 30, sampleMs: 250, grid: false, legend: false },
    tags: { series: ['DEMO.WAVE'] },
  }),
  widget('bar_h', 'Cột ngang', 'bar', 1160, 40, 720, 320, {
    props: { orientation: 'horizontal', labels: ['Mức', 'Nhiệt độ', 'Áp suất', 'Lưu lượng'] },
    tags: { series: ['TANK01.LEVEL', 'SIM.TEMP', 'SIM.PRESS', 'SIM.FLOW'] },
  }),
  widget('pie_a', 'Tỉ trọng', 'pie', 1160, 380, 340, 340, {
    props: { donut: true, showTotal: true, labels: ['Lưu lượng', 'Nhiệt độ', 'Áp suất'] },
    tags: { series: ['SIM.FLOW', 'SIM.TEMP', 'SIM.PRESS'] },
  }),
  widget('gauge_p', 'Áp suất', 'gauge', 1520, 380, 360, 340, {
    props: { label: 'Áp suất', min: 0, max: 10 },
    tags: { value: 'SIM.PRESS' },
  }),
  widget('table_a', 'Giá trị Tag', 'tag-table', 1160, 740, 720, 280, {
    props: { columns: ['label', 'value', 'unit', 'quality', 'updated'], dense: true },
    tags: {
      rows: [
        'TANK01.LEVEL',
        'TANK01.VOLUME',
        'TANK01.SP',
        'PUMP01.STATE',
        'PUMP01.FAULT',
        'METER1.P',
        'SIM.TEMP',
        'SIM.PRESS',
        'SIM.FLOW',
        'SIM.ALARM',
      ],
    },
  }),
]);

// ---------------- Màn hình 4: popup Bơm 1 (640 x 420) ----------------
const pump = screen(
  'bom1',
  'Bơm 1',
  { width: 640, height: 420 },
  [
    widget('panel_p', 'Khung', 'panel', 0, 0, 640, 420, { props: { title: 'Bơm 1' } }),
    widget('name_p', 'Tên', 'label', 20, 50, 300, 40, {
      props: { text: 'Tên:' },
      tags: { value: 'PUMP01.NAME' },
    }),
    widget('state_p', 'Trạng thái', 'card', 20, 100, 280, 110, {
      props: { label: 'Trạng thái' },
      tags: { value: 'PUMP01.STATE_TEXT' },
    }),
    widget('power_p', 'Công suất', 'card', 320, 100, 300, 110, {
      props: { label: 'Công suất', decimals: 2 },
      tags: { value: 'METER1.P' },
    }),
    widget('lamp_p', 'Đèn lỗi', 'lamp', 20, 230, 280, 40, {
      props: { label: 'Lỗi', onColor: '#C62828' },
      tags: { state: 'PUMP01.FAULT' },
    }),
    widget('sw_p', 'Công tắc', 'switch', 320, 230, 220, 48, {
      props: { label: 'Chạy bơm' },
      tags: { target: 'PUMP01.RUN_CMD' },
    }),
    widget('btn_close', 'Đóng', 'button', 440, 350, 180, 48, {
      props: { label: 'Đóng', variant: 'neutral' },
      events: { click: { action: 'closePopup' } },
    }),
  ],
  { kind: 'popup' },
);

// ---------------- SVG và binding của item svg ----------------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520">
  <rect x="20" y="20" width="200" height="400" rx="8" fill="none" stroke="#475569" stroke-width="4"/>
  <rect data-mat-uid="el_tank" x="24" y="24" width="192" height="392" fill="#38bdf8"/>
  <rect x="220" y="380" width="160" height="16" fill="#64748b"/>
  <circle data-mat-uid="el_pump" cx="430" cy="388" r="60" fill="#64748b"/>
  <text data-mat-uid="el_state" x="430" y="480" text-anchor="middle" font-size="28" fill="#94a3b8">--</text>
</svg>
`;
const bind = (id, target, tagId, transform) => ({
  id,
  target,
  source: { type: 'tag', tagId },
  transform,
});
const bindings = {
  schemaVersion: V,
  screenId: 'tong-quan',
  itemId: 'svg1',
  elements: [
    {
      elementUid: 'el_tank',
      bindings: [bind('b1', 'geometry.levelPercent', 'TANK01.LEVEL', { kind: 'direct' })],
    },
    {
      elementUid: 'el_pump',
      bindings: [
        bind('b2', 'style.fill', 'PUMP01.FAULT', {
          kind: 'discreteMap',
          cases: [
            { equals: true, value: '#ef4444' },
            { equals: false, value: '#64748b' },
          ],
        }),
      ],
    },
    {
      elementUid: 'el_state',
      bindings: [
        bind('b3', 'text.content', 'PUMP01.STATE', { kind: 'valueTable', output: 'text' }),
        bind('b4', 'style.fill', 'PUMP01.STATE', {
          kind: 'valueTable',
          table: 'TrangThaiBom',
          output: 'color',
        }),
      ],
    },
  ],
};

// ---------------- project.json ----------------
const project = {
  format: 'matscada-project',
  schemaVersion: V,
  projectId: 'dashboard-demo',
  projectName: 'Demo bảng điều khiển',
  projectVersion: '0.1.0',
  minRuntimeVersion: '0.6.0',
  entryScreen: 'tong-quan',
  screens: ['tong-quan', 'bon-nuoc', 'giam-sat', 'bom1'],
  tagFile: 'tags.json',
  connectionFile: 'connections.json',
  valueTables: ['TrangThaiBom'],
  navigation: {
    position: 'left',
    items: [
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Bồn nước', screen: 'bon-nuoc', icon: 'tank' },
      { label: 'Giám sát', screen: 'giam-sat', icon: 'chart' },
    ],
  },
  maxClients: 10,
};

// ---------------- Ghi ----------------
const json2 = (v) => JSON.stringify(v, null, 2) + '\n';
const files = {
  'project.json': formatProject03(project),
  'tags.json': tagsText,
  'connections.json': to03(src('connections.json')),
  'value-tables/TrangThaiBom.json': to03(src('value-tables/TrangThaiBom.json')),
  'screens/tong-quan.screen.json': formatScreen03(overview),
  'screens/tong-quan.svg': svg,
  'screens/tong-quan.bindings.json': json2(bindings),
  'screens/bon-nuoc.screen.json': formatScreen03(tank),
  'screens/giam-sat.screen.json': formatScreen03(monitor),
  'screens/bom1.screen.json': formatScreen03(pump),
};

// Chỉ xóa thư mục ra cũ khi đó là project do công cụ này sinh (có project.json) hoặc còn rỗng.
if (existsSync(outDir)) {
  const names = readdirSync(outDir);
  if (names.length > 0 && !names.includes('project.json')) {
    console.error(`Thư mục ra '${outDir}' không rỗng và không phải một project: không ghi đè.`);
    process.exit(2);
  }
  for (const n of names)
    if (n !== 'README.md') rmSync(join(outDir, n), { recursive: true, force: true });
}
for (const [rel, text] of Object.entries(files)) {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
console.log(`dashboard-demo: ${Object.keys(files).length} tệp trong ${outDir}`);
