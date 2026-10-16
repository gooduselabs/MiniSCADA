// Sinh project mẫu `projects/dashboard-demo` (1.0.0; specs/007-screens-widgets/quickstart.md §0, feature 011 T175):
//   node tools/dashboard-demo/generate.mjs [--out <thư mục>]
//   node tools/dashboard-demo/generate.mjs --format 0.3 --out tests/fixtures/dashboard-demo-0.3   (chỉ phần nền 0.3)
// Phần nền (như trước feature 011): 4 màn hình Tổng quan (1 item svg + 26 widget, đủ 15 loại), Bồn nước, Giám sát
// (biểu đồ, bảng Tag), popup Bơm 1; menu điều hướng bên trái. Tag, kết nối, bảng giá trị chép từ `projects/modbus-demo`
// (đổi schemaVersion), cộng Tag mô phỏng tất định (SIM.*). Phần nền được dựng ở 0.3.0 rồi nâng lên 1.0.0 bằng chính
// `migrateTo10` của @mat/project-schema (bản dựng thẳng ở 1.0.0 phải bằng đầu ra đó, khác thì dừng với mã 1).
// Phần 1.0 (SC-037): template `bom` (đèn chạy, thẻ lưu lượng, nút "Chi tiết" mở faceplate), màn hình "Bơm" với 20 bản
// sao pump1..pump20 bung khi lưu (item thường `<inst>.<rid>` mang chú thích `tpl`, thay tham số bằng `substituteParams`),
// faceplate `bom-chi-tiet` (popup có tham số `prefix`, `title`) và Tag PUMP01..PUMP20 (.RUN, .FLOW, .RUN_CMD, .FAULT).
// Đầu ra được commit; chạy lại cho cùng từng byte (test: generate.test.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalItem,
  formatProject03,
  formatScreen03,
  formatTagsFile,
  migrateTo10,
  substituteParams,
} from '@mat/project-schema';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
/** Phiên bản của phần nền trước khi nâng (định dạng gốc của project mẫu này, feature 007). */
const V = '0.3.0';
/** Phiên bản ghi ra (feature 011): template và faceplate cần 1.0.0. */
const V10 = '1.0.0';
const MIN_RUNTIME_10 = '1.0.0';

const outFlag = process.argv.indexOf('--out');
const outDir = resolve(
  outFlag >= 0 ? (process.argv[outFlag + 1] ?? '') : join(root, 'projects/dashboard-demo'),
);
// `--format 0.3`: chỉ ghi phần nền 0.3 (bản đóng băng tests/fixtures/dashboard-demo-0.3 mà vector migration, svg-demo và
// test của Studio dùng thay cho project mẫu cũ); cần `--out` để không ghi đè project mẫu 1.0.
const formatFlag = process.argv.indexOf('--format');
const format = formatFlag >= 0 ? process.argv[formatFlag + 1] : '1.0';
if (
  (outFlag >= 0 && !process.argv[outFlag + 1]) ||
  (format !== '1.0' && format !== '0.3') ||
  (format === '0.3' && outFlag < 0)
) {
  console.error(
    'Dùng: node tools/dashboard-demo/generate.mjs [--out <thư mục>] | --format 0.3 --out <thư mục>',
  );
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
  <rect x="340" y="446" width="180" height="46" rx="8" fill="#0f172a"/>
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

// Bảng giá trị riêng của demo: màu sáng, dùng làm chữ trên nền tối cố định (#0f172a trong SVG) nên đạt tương phản >= 4,5:1
// ở cả hai theme (không phụ thuộc nền của trang). Bản của modbus-demo dùng nền theme nên không dùng lại được.
const valueTable = {
  schemaVersion: V,
  name: 'TrangThaiBom',
  entries: [
    { value: 0, text: 'Dừng', color: '#9ca3af' },
    { value: 1, text: 'Chạy', color: '#4ade80' },
    { value: 2, text: 'Lỗi', color: '#f87171' },
    { from: 10, to: 20, text: 'Bảo trì' },
  ],
  default: { text: 'Không rõ', color: '#fbbf24' },
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

// ---------------- Phần nền 0.3 rồi nâng lên 1.0 bằng migration ----------------
const json2 = (v) => JSON.stringify(v, null, 2) + '\n';
const base03 = {
  'project.json': formatProject03(project),
  'tags.json': tagsText,
  'connections.json': to03(src('connections.json')),
  'value-tables/TrangThaiBom.json': json2(valueTable),
  'screens/tong-quan.screen.json': formatScreen03(overview),
  'screens/tong-quan.svg': svg,
  'screens/tong-quan.bindings.json': json2(bindings),
  'screens/bon-nuoc.screen.json': formatScreen03(tank),
  'screens/giam-sat.screen.json': formatScreen03(monitor),
  'screens/bom1.screen.json': formatScreen03(pump),
};
const migrated = await migrateTo10(base03);
if (!migrated.ok) {
  console.error(`dashboard-demo: migrateTo10 thất bại: ${JSON.stringify(migrated.error)}`);
  process.exit(1);
}
const to10 = (o) => ({ ...o, schemaVersion: V10 });
// Bản dựng thẳng ở 1.0.0 của phần nền phải bằng đầu ra của migration (migration 1.0 thuần thêm: chỉ đổi phiên bản).
const project10 = { ...to10(project), minRuntimeVersion: MIN_RUNTIME_10 };
const direct10 = {
  'project.json': formatProject03(project10),
  'tags.json': formatTagsFile({ schemaVersion: V10, tags: [...modbusTags, ...simTags] }),
  'screens/tong-quan.screen.json': formatScreen03(to10(overview)),
  'screens/bon-nuoc.screen.json': formatScreen03(to10(tank)),
  'screens/giam-sat.screen.json': formatScreen03(to10(monitor)),
  'screens/bom1.screen.json': formatScreen03(to10(pump)),
  'screens/tong-quan.bindings.json': json2(to10(bindings)),
  'value-tables/TrangThaiBom.json': json2(to10(valueTable)),
};
for (const [rel, text] of Object.entries(direct10))
  if (migrated.files[rel] !== text) {
    console.error(`dashboard-demo: ${rel} dựng thẳng ở 1.0.0 khác đầu ra của migrateTo10`);
    process.exit(1);
  }

// ---------------- Phần 1.0: Tag của 20 bơm ----------------
const N_PUMPS = 20;
const pad2 = (n) => String(n).padStart(2, '0');
/** Lưu lượng cố định của bơm n (m3/h): mỗi bơm một giá trị khác nhau để kiểm thay tham số (web-it faceplate). */
const pumpFlow = (n) => n * 5;
/** Lệnh chạy ban đầu: bơm lẻ chạy. */
const pumpRunInitial = (n) => n % 2 === 1;
/** Lỗi mô phỏng cố định: bơm 7 và 14. */
const pumpFault = (n) => n % 7 === 0;
const pumpTags = [];
for (let n = 1; n <= N_PUMPS; n++) {
  const P = `PUMP${pad2(n)}`;
  // PUMP01.RUN_CMD và PUMP01.FAULT có sẵn (Modbus, của modbus-demo); trạng thái chạy của bơm 1 suy từ PUMP01.STATE.
  if (n > 1)
    pumpTags.push({
      id: `${P}.RUN_CMD`,
      kind: 'simulation',
      type: 'BOOL',
      description: `Lệnh chạy bơm ${n} (nhập tay)`,
      access: 'RW',
      sim: { kind: 'manual', initial: pumpRunInitial(n) },
    });
  pumpTags.push({
    id: `${P}.RUN`,
    kind: 'calculated',
    type: 'BOOL',
    description: `Bơm ${n} đang chạy`,
    expression: n === 1 ? 'PUMP01.STATE == 1' : `${P}.RUN_CMD`,
  });
  pumpTags.push({
    id: `${P}.FLOW`,
    kind: 'simulation',
    type: 'FLOAT32',
    description: `Lưu lượng bơm ${n} (mô phỏng, cố định)`,
    unit: 'm3/h',
    min: 0,
    max: 120,
    sim: { kind: 'manual', initial: pumpFlow(n) },
  });
  if (n > 1)
    pumpTags.push({
      id: `${P}.FAULT`,
      kind: 'simulation',
      type: 'BOOL',
      description: `Lỗi bơm ${n} (mô phỏng, cố định)`,
      sim: { kind: 'manual', initial: pumpFault(n) },
    });
}

// ---------------- Template `bom` (contracts/project-format-1.0.md §3) ----------------
const template = {
  schemaVersion: V10,
  id: 'bom',
  name: 'Bơm có đèn và lưu lượng',
  size: { width: 220, height: 170 },
  params: [
    { name: 'prefix', kind: 'tagPrefix', default: 'PUMP01' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  // Item ở dạng chuẩn (canonicalItem) để bản bung khớp từng khóa với item đã ghi (không W_TEMPLATE_DRIFT)
  items: [
    widget('lamp', 'Đèn chạy', 'lamp', 10, 10, 200, 36, {
      props: { label: '{title}', onColor: '#2E7D32' },
      tags: { state: '{prefix}.RUN' },
    }),
    widget('flow', 'Lưu lượng', 'card', 10, 52, 200, 64, {
      props: { label: '{title} (lưu lượng)' },
      tags: { value: '{prefix}.FLOW' },
    }),
    widget('detail', 'Chi tiết', 'button', 10, 122, 200, 40, {
      props: { label: 'Chi tiết', variant: 'neutral' },
      events: {
        click: {
          action: 'popup',
          screen: 'bom-chi-tiet',
          args: { prefix: '{prefix}', title: '{title}' },
        },
      },
    }),
  ].map(canonicalItem),
};

/**
 * Bung một bản sao (§4, như Studio khi lưu): mỗi item của template thay tham số bằng `substituteParams` (cho phép `{name}`
 * trong `args` của hành động popup), id `<inst>.<rid>`, vị trí = vị trí trong template + phần dịch (dx, dy); `tpl` mang
 * `params` trên MỌI item của bản sao (quy ước tự đủ).
 */
function instance(inst, params, dx, dy) {
  return template.items.map((t) => {
    const r = substituteParams(t, template.params, params, { template: true });
    if (!r.ok) {
      console.error(`dashboard-demo: bung '${inst}.${t.id}' lỗi: ${JSON.stringify(r.problems)}`);
      process.exit(1);
    }
    return {
      ...r.value,
      id: `${inst}.${t.id}`,
      x: t.x + dx,
      y: t.y + dy,
      tpl: { inst, tid: template.id, rid: t.id, params },
    };
  });
}

// ---------------- Màn hình "Bơm" (1280 x 800): 20 bản sao, lưới 5 x 4 ----------------
const COLS = 5;
const pumpsItems = [
  widget('panel_hdr', 'Khung tiêu đề', 'panel', 0, 0, 1280, 60, {
    props: { title: 'Trạm bơm: 20 bơm' },
  }),
];
for (let n = 1; n <= N_PUMPS; n++) {
  const col = (n - 1) % COLS;
  const row = Math.floor((n - 1) / COLS);
  const params = { prefix: `PUMP${pad2(n)}`, title: `Bơm ${n}` };
  pumpsItems.push(...instance(`pump${n}`, params, 40 + col * 240, 74 + row * 180));
}
const pumps = to10(screen('bom', 'Bơm', { width: 1280, height: 800 }, pumpsItems));

// ---------------- Faceplate `bom-chi-tiet` (popup có tham số, §5; 640 x 420) ----------------
const faceplateItems = [
  widget('panel_f', 'Khung', 'panel', 0, 0, 640, 420, { props: { title: '{title}' } }),
  widget('run_l', 'Đèn chạy', 'lamp', 20, 60, 280, 40, {
    props: { label: 'Đang chạy', onColor: '#2E7D32' },
    tags: { state: '{prefix}.RUN' },
  }),
  widget('fault_l', 'Đèn lỗi', 'lamp', 20, 110, 280, 40, {
    props: { label: 'Lỗi', onColor: '#C62828' },
    tags: { state: '{prefix}.FAULT' },
  }),
  widget('flow_c', 'Lưu lượng', 'card', 320, 60, 300, 110, {
    props: { label: 'Lưu lượng {title}' },
    tags: { value: '{prefix}.FLOW' },
  }),
  widget('run_sw', 'Công tắc', 'switch', 20, 180, 280, 48, {
    props: { label: 'Chạy {title}' },
    tags: { target: '{prefix}.RUN_CMD' },
  }),
  widget('table_f', 'Bảng Tag', 'tag-table', 20, 250, 600, 90, {
    props: { dense: true },
    tags: { rows: ['{prefix}.RUN', '{prefix}.FLOW', '{prefix}.FAULT'] },
  }),
  widget('btn_close', 'Đóng', 'button', 440, 360, 180, 48, {
    props: { label: 'Đóng', variant: 'neutral' },
    events: { click: { action: 'closePopup' } },
  }),
];
const faceplate = {
  ...to10(
    screen('bom-chi-tiet', 'Chi tiết bơm', { width: 640, height: 420 }, faceplateItems, {
      kind: 'popup',
    }),
  ),
  params: [
    { name: 'prefix', kind: 'tagPrefix' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
};

// Tệp màn hình 1.0 ghi bằng formatScreen03 của Studio (đã biết `params` của popup và `tpl` của item). Kiểm lại: đọc ra
// phải còn đủ phần 1.0 (bản formatScreen03 cũ bỏ hai phần này: dừng thay vì ghi một project lệch template).
function formatScreen10(s) {
  const text = formatScreen03(s);
  const back = JSON.parse(text);
  const lost =
    JSON.stringify(back.params) !== JSON.stringify(s.params) ||
    s.items.some((it, i) => JSON.stringify(back.items[i].tpl) !== JSON.stringify(it.tpl));
  if (lost) {
    console.error(`dashboard-demo: formatScreen03 không ghi đủ params/tpl của màn hình '${s.id}'`);
    process.exit(1);
  }
  return text;
}

// ---------------- project.json 1.0 ----------------
// Giữ thứ tự khóa của phần nền; `templates` đứng ngay sau `valueTables` (trước `navigation`, `maxClients`).
const projectOut = {};
for (const [k, v] of Object.entries(project10)) {
  if (k === 'screens') projectOut.screens = [...v, 'bom', 'bom-chi-tiet'];
  else if (k === 'navigation')
    projectOut.navigation = {
      ...v,
      items: [...v.items, { label: 'Bơm', screen: 'bom', icon: 'pump' }],
    };
  else projectOut[k] = v;
  if (k === 'valueTables') projectOut.templates = ['templates/bom.template.json'];
}

// ---------------- Ghi: phần nền đúng như migration cho, cộng phần 1.0 ----------------
const files =
  format === '0.3'
    ? base03
    : {
        ...migrated.files,
        'project.json': formatProject03(projectOut),
        'tags.json': formatTagsFile({
          schemaVersion: V10,
          tags: [...modbusTags, ...simTags, ...pumpTags],
        }),
        'templates/bom.template.json': json2(template),
        'screens/bom.screen.json': formatScreen10(pumps),
        'screens/bom-chi-tiet.screen.json': formatScreen10(faceplate),
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
