// Sinh bộ vector danh mục widget dùng chung TS <-> C++ (specs/007-screens-widgets/contracts/widget-catalog.md §5).
//   node tests/widget-catalog-vectors/generate.mjs
// Kết quả được commit; Vitest (vectors-03.test.ts) và GoogleTest đọc thẳng các thư mục này. Định dạng: README.md.
// Ca hợp lệ "mọi thuộc tính ở giá trị biên" được dựng từ chính danh mục (schemas/widgets.catalog.json): hai ca
// cho mỗi loại, một ca ở cận dưới và một ca ở cận trên của từng thuộc tính. Ca vi phạm viết tay.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyCases, loggingFor } from './history010.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(resolve(here, '../../schemas/widgets.catalog.json'), 'utf8'),
);
const V = '0.3.0';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const pad = (i) => String(i).padStart(3, '0');

// ---- Tag chuẩn của mọi ca (tags.json) ----
const tags = () => ({
  schemaVersion: V,
  tags: [
    { id: 'L.LEVEL', kind: 'internal', type: 'FLOAT32', unit: '%', min: 0, max: 100, initial: 0 },
    {
      id: 'L.SP',
      kind: 'internal',
      type: 'FLOAT32',
      access: 'RW',
      limits: { min: 0, max: 90 },
      initial: 0,
    },
    { id: 'L.CMD', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
    { id: 'L.FLAG', kind: 'internal', type: 'BOOL', initial: false },
    {
      id: 'L.TXT',
      kind: 'internal',
      type: 'STRING',
      access: 'RW',
      limits: { maxLength: 8 },
      initial: '',
    },
    { id: 'L.NAME', kind: 'internal', type: 'STRING', initial: 'ten' },
    {
      id: 'L.INT',
      kind: 'internal',
      type: 'INT16',
      access: 'RW',
      limits: { min: -100, max: 100 },
      valueTable: 'TrangThaiBom',
      initial: 0,
    },
    { id: 'L.STATE', kind: 'internal', type: 'INT16', valueTable: 'TrangThaiBom', initial: 0 },
    {
      id: 'L.PLAIN',
      kind: 'internal',
      type: 'INT16',
      access: 'RW',
      limits: { min: 0, max: 5 },
      initial: 0,
    },
    { id: 'L.CALC', kind: 'calculated', type: 'FLOAT32', expression: 'L.LEVEL * 2' },
    {
      id: 'L.SIM',
      kind: 'simulation',
      type: 'FLOAT32',
      sim: { kind: 'sine', center: 50, amplitude: 25, periodMs: 20000 },
    },
    {
      id: 'L.SIMSET',
      kind: 'simulation',
      type: 'INT16',
      access: 'RW',
      limits: { min: 0, max: 10 },
      sim: { kind: 'manual', initial: 0 },
    },
    { id: 'L.FREE', kind: 'internal', type: 'FLOAT32', access: 'RW', initial: 0 },
    {
      id: 'L.U16',
      kind: 'internal',
      type: 'UINT16',
      access: 'RW',
      limits: { min: 0, max: 65535 },
      initial: 0,
    },
    {
      id: 'L.EXT_CMD',
      kind: 'external',
      type: 'BOOL',
      access: 'RW',
      source: { device: 'plc1', address: 'C10' },
    },
    {
      id: 'L.EXT_NOREAD',
      kind: 'external',
      type: 'BOOL',
      access: 'RW',
      source: { device: 'plc1', address: 'C11', readback: false },
    },
    ...Array.from({ length: 60 }, (_, i) => ({
      id: `M.T${pad(i + 1)}`,
      kind: 'internal',
      type: 'FLOAT32',
      initial: 0,
    })),
  ],
});
const connections = () => ({
  schemaVersion: V,
  channels: [
    {
      id: 'plc1',
      name: 'PLC',
      kind: 'modbus-tcp',
      tcp: { host: '192.168.10.5', port: 502 },
      devices: [{ id: 'plc1', name: 'PLC', unitId: 1 }],
    },
  ],
});
const valueTable = () => ({
  schemaVersion: V,
  name: 'TrangThaiBom',
  entries: [
    { value: 0, text: 'Dừng', color: '#808080' },
    { value: 1, text: 'Chạy', color: '#2E7D32' },
  ],
});
const popup = () => ({
  schemaVersion: V,
  id: 'pump',
  name: 'Bơm',
  kind: 'popup',
  size: { width: 480, height: 320 },
  items: [],
});
const other = () => ({
  schemaVersion: V,
  id: 'other',
  name: 'Màn hình khác',
  size: { width: 640, height: 480 },
  items: [],
});

const W = (id, widget, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  x: 10,
  y: 10,
  width: 300,
  height: 200,
  ...extra,
});

// ---- Ghi ca ----
const cases = [];
/** files: { đường dẫn: nội dung } ghi thêm; expect: [{ code, path }] của file screens/main.screen.json. */
const add = (name, items, expect, o = {}) => cases.push({ name, items, expect, ...o });
const E = (code, path) => ({ code, path });
const e0 = (code, sub = '') => E(code, `/items/0${sub}`);

// ================= Hợp lệ: mọi thuộc tính ở cận dưới/cận trên, dựng từ danh mục =================
const slotTags = (w, hi) => {
  const out = {};
  for (const s of w.slots) {
    if (!s.required && !hi) continue;
    const pick = (types) =>
      types.includes('number') ? 'L.LEVEL' : types.includes('bool') ? 'L.FLAG' : 'L.NAME';
    if (s.multi) {
      const n = hi ? s.max : 1;
      out[s.name] = Array.from({ length: n }, (_, i) => `M.T${pad(i + 1)}`);
    } else if (s.needsWrite) {
      out[s.name] = s.types.includes('bool') && !s.types.includes('number') ? 'L.CMD' : 'L.SP';
    } else out[s.name] = pick(s.types);
  }
  return out;
};
const propValue = (w, p, hi) => {
  const lo = !hi;
  switch (p.kind) {
    case 'string':
      return lo ? '' : 'ằ'.repeat(p.maxLength ?? 1);
    case 'int':
    case 'number': {
      if (p.name === 'step') return lo ? 0.001 : 1000;
      if (p.kind === 'int') return lo ? p.min : p.max;
      return null; // cặp min/max, yMin/yMax: xử lý riêng
    }
    case 'bool':
      return lo ? false : true;
    case 'enum':
      return lo ? p.options[0] : p.options.at(-1);
    case 'color':
      return lo ? (p.allowAuto ? 'auto' : '#000000') : '#FFFFFF';
    case 'tableRef':
      return 'TrangThaiBom';
    case 'array': {
      const n = lo ? 0 : p.maxItems;
      if (p.name === 'zones')
        return Array.from({ length: n }, (_, i) => ({
          from: i * 10,
          to: i * 10 + 10,
          color: '#FF0000',
        }));
      if (p.items.options) return p.items.options.slice(0, lo ? (p.minItems ?? 0) : n);
      return Array.from({ length: n }, () => (lo ? '' : 'ằ'.repeat(p.items.maxLength)));
    }
    case 'object':
      // alarm-count.target: cận dưới là mặc định, cận trên trỏ một màn hình thường (tệp `other` của ca)
      return lo ? { kind: 'alarms' } : { kind: 'screen', screen: 'other' };
  }
  return undefined;
};
for (const w of catalog.widgets) {
  if (w.group === 'history') continue; // widget lịch sử (feature 010): ca riêng ở history010.mjs
  for (const hi of [false, true]) {
    const props = {};
    for (const p of w.props) {
      const v = propValue(w, p, hi);
      if (v !== null && v !== undefined) props[p.name] = v;
    }
    const names = new Set(w.props.map((p) => p.name));
    if (names.has('min') && names.has('max')) {
      const limited = w.id === 'setpoint' || w.id === 'slider';
      Object.assign(
        props,
        limited
          ? hi
            ? { min: 0.5, max: 89.5 }
            : { min: 0, max: 90 }
          : hi
            ? { min: -1000, max: 1000 }
            : { min: 0, max: 1 },
      );
    }
    if (names.has('yMin'))
      Object.assign(props, hi ? { yMin: -1000, yMax: 1000 } : { yMin: 0, yMax: 1 });
    const item = W(`${w.id.replace(/-/g, '')}1`, w.id, {
      x: 0,
      y: 0,
      width: hi ? 1200 : w.defaultSize[0],
      height: hi ? 700 : w.defaultSize[1],
      props,
    });
    const t = slotTags(w, hi);
    if (Object.keys(t).length > 0) item.tags = t;
    const warnings = [];
    if (w.id === 'button') {
      // cận trên: confirm = none trên Tag BOOL (hợp lệ, có cảnh báo); cận dưới: không hành động
      if (hi) {
        item.tags = { target: 'L.CMD' };
        item.events = { click: { action: 'toggle' } };
        item.security = { minRole: 'administrator' };
        warnings.push(E('W_CONFIRM_NONE', '/items/0/props/confirm'));
      }
    } else if (w.id === 'switch' && hi) {
      warnings.push(E('W_CONFIRM_NONE', '/items/0/props/confirm'));
      item.security = { minRole: 'engineer' };
    } else if (w.group === 'control' && hi) item.security = { minRole: 'administrator' };
    if (w.group === 'control' && !hi) item.security = { minRole: 'operator' };
    // select: cận dưới dùng bảng của Tag nên không cần props.table; ở đây đã có props.table
    add(
      `valid-${w.id}-${hi ? 'upper' : 'lower'}`,
      [item],
      warnings,
      w.id === 'alarm-count' && hi ? { files: { 'screens/other.screen.json': other() } } : {},
    );
  }
}

// ================= Hợp lệ khác =================
add(
  'valid-button-write-string',
  [
    W('b1', 'button', {
      tags: { target: 'L.TXT' },
      events: { click: { action: 'write', value: 'ab' } },
    }),
  ],
  [],
);
add(
  'valid-button-write-number-limits',
  [
    W('b1', 'button', {
      tags: { target: 'L.SP' },
      events: { click: { action: 'write', value: 90 } },
    }),
  ],
  [],
);
add(
  'valid-button-pulse',
  [
    W('b1', 'button', {
      tags: { target: 'L.EXT_NOREAD' },
      events: { click: { action: 'pulse', value: true, durationMs: 100 } },
    }),
  ],
  [],
);
add(
  'valid-button-navigate',
  [W('b1', 'button', { events: { click: { action: 'navigate', screen: 'other' } } })],
  [],
  {
    files: { 'screens/other.screen.json': other() },
  },
);
add(
  'valid-button-popup',
  [W('b1', 'button', { events: { click: { action: 'popup', screen: 'pump' } } })],
  [],
  {
    files: { 'screens/pump.screen.json': popup() },
  },
);
add(
  'valid-select-bool',
  [W('s1', 'select', { props: { table: 'TrangThaiBom' }, tags: { target: 'L.CMD' } })],
  [],
);
add('valid-select-table-of-tag', [W('s1', 'select', { tags: { target: 'L.INT' } })], []);
add('valid-lamp-number', [W('l1', 'lamp', { tags: { state: 'L.STATE' } })], []);
add('valid-card-string', [W('c1', 'card', { tags: { value: 'L.NAME' } })], []);
add(
  'valid-card-calculated-and-sim',
  [
    W('c1', 'card', { tags: { value: 'L.CALC' } }),
    W('c2', 'card', { x: 400, tags: { value: 'L.SIM' } }),
  ],
  [],
);
add('valid-slider-manual-sim', [W('s1', 'slider', { tags: { target: 'L.SIMSET' } })], []);
add('valid-line-bool-series', [W('l1', 'line', { tags: { series: ['L.FLAG', 'L.LEVEL'] } })], []);
add(
  'valid-tag-table-mixed',
  [W('t1', 'tag-table', { tags: { rows: ['L.NAME', 'L.FLAG', 'L.LEVEL'] } })],
  [],
);

// ================= Vi phạm khe =================
add(
  'slot-unknown',
  [W('c1', 'card', { tags: { value: 'L.LEVEL', extra: 'L.SP' } })],
  [e0('E_WIDGET_SLOT', '/tags/extra')],
);
add('slot-required-missing', [W('c1', 'card', { tags: {} })], [e0('E_WIDGET_SLOT', '/tags')]);
add(
  'slot-panel-has-tags',
  [W('p1', 'panel', { tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_SLOT', '/tags/value')],
);
add(
  'slot-multi-string',
  [W('l1', 'line', { tags: { series: 'L.LEVEL' } })],
  [e0('E_WIDGET_SLOT', '/tags/series')],
);
add(
  'slot-multi-dup',
  [W('l1', 'line', { tags: { series: ['L.LEVEL', 'L.SP', 'L.LEVEL'] } })],
  [e0('E_WIDGET_SLOT', '/tags/series/2')],
);
add(
  'slot-single-array',
  [W('c1', 'card', { tags: { value: ['L.LEVEL'] } })],
  [e0('E_WIDGET_SLOT', '/tags/value')],
);
add(
  'slot-button-write-no-target',
  [W('b1', 'button', { events: { click: { action: 'write', value: true } } })],
  [e0('E_WIDGET_SLOT', '/tags')],
);
add(
  'slot-button-navigate-with-target',
  [
    W('b1', 'button', {
      tags: { target: 'L.CMD' },
      events: { click: { action: 'navigate', screen: 'other' } },
    }),
  ],
  [e0('E_WIDGET_SLOT', '/tags/target')],
  {
    files: { 'screens/other.screen.json': other() },
  },
);
add(
  'slot-limit-line-9',
  [W('l1', 'line', { tags: { series: Array.from({ length: 9 }, (_, i) => `M.T${pad(i + 1)}`) } })],
  [e0('E_LIMIT', '/tags/series')],
);
add(
  'slot-limit-table-51',
  [
    W('t1', 'tag-table', {
      tags: { rows: Array.from({ length: 51 }, (_, i) => `M.T${pad(i + 1)}`) },
    }),
  ],
  [e0('E_LIMIT', '/tags/rows')],
);

// ================= Vi phạm kiểu và quyền Tag =================
add(
  'type-gauge-bool',
  [W('g1', 'gauge', { tags: { value: 'L.FLAG' } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/value')],
);
add(
  'type-lamp-string',
  [W('l1', 'lamp', { tags: { state: 'L.NAME' } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/state')],
);
add(
  'type-pie-bool',
  [W('p1', 'pie', { tags: { series: ['L.LEVEL', 'L.FLAG'] } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/series/1')],
);
add(
  'type-line-string',
  [W('l1', 'line', { tags: { series: ['L.NAME'] } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/series/0')],
);
add(
  'type-switch-number',
  [W('s1', 'switch', { tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/target')],
);
add(
  'type-setpoint-bool',
  [W('s1', 'setpoint', { tags: { target: 'L.CMD' } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/target')],
);
add(
  'type-select-string',
  [W('s1', 'select', { props: { table: 'TrangThaiBom' }, tags: { target: 'L.TXT' } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/target')],
);
add(
  'type-toggle-number',
  [W('b1', 'button', { tags: { target: 'L.SP' }, events: { click: { action: 'toggle' } } })],
  [e0('E_WIDGET_TAG_TYPE', '/tags/target')],
);
add(
  'ref-tag-unknown',
  [W('c1', 'card', { tags: { value: 'NO.TAG' } })],
  [e0('E_REF_TAG', '/tags/value')],
);
add(
  'ref-tag-multi',
  [W('l1', 'line', { tags: { series: ['L.LEVEL', 'NO.TAG'] } })],
  [e0('E_REF_TAG', '/tags/series/1')],
);
add(
  'ref-table-unknown',
  [W('s1', 'select', { props: { table: 'KhongCo' }, tags: { target: 'L.PLAIN' } })],
  [e0('E_REF_TABLE', '/props/table')],
);
add(
  'access-switch-readonly',
  [W('s1', 'switch', { tags: { target: 'L.FLAG' } })],
  [e0('E_TAG_ACCESS', '/tags/target')],
);
add(
  'access-setpoint-calculated',
  [W('s1', 'setpoint', { tags: { target: 'L.CALC' } })],
  [e0('E_TAG_ACCESS', '/tags/target')],
);
add(
  'access-slider-simulation',
  [W('s1', 'slider', { tags: { target: 'L.SIM' } })],
  [e0('E_TAG_ACCESS', '/tags/target')],
);
add(
  'access-button-write-readonly',
  [
    W('b1', 'button', {
      tags: { target: 'L.FLAG' },
      events: { click: { action: 'write', value: true } },
    }),
  ],
  [e0('E_TAG_ACCESS', '/tags/target')],
);

// ================= Vi phạm thuộc tính =================
add(
  'prop-unknown',
  [W('c1', 'card', { props: { color: '#FF0000' }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/color')],
);
add(
  'prop-wrong-type',
  [W('c1', 'card', { props: { decimals: '1' }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/decimals')],
);
add(
  'prop-above-max',
  [W('c1', 'card', { props: { decimals: 7 }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/decimals')],
);
add(
  'prop-enum',
  [W('c1', 'card', { props: { fontSize: 'xxl' }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/fontSize')],
);
add(
  'prop-color',
  [W('c1', 'card', { props: { background: '#123' }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/background')],
);
add(
  'prop-label-too-long',
  [W('c1', 'card', { props: { label: 'L'.repeat(41) }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/label')],
);
add(
  'prop-label-counts-code-points',
  [W('c1', 'card', { props: { label: 'ằ'.repeat(41) }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_PROP', '/props/label')],
);
add(
  'prop-zones-overlap',
  [
    W('g1', 'gauge', {
      props: {
        zones: [
          { from: 0, to: 50, color: '#00FF00' },
          { from: 40, to: 80, color: '#FF0000' },
        ],
      },
      tags: { value: 'L.LEVEL' },
    }),
  ],
  [e0('E_WIDGET_PROP', '/props/zones')],
);
add(
  'prop-zones-5',
  [
    W('g1', 'gauge', {
      props: {
        zones: [0, 1, 2, 3, 4].map((i) => ({ from: i * 10, to: i * 10 + 10, color: '#00FF00' })),
      },
      tags: { value: 'L.LEVEL' },
    }),
  ],
  [e0('E_WIDGET_PROP', '/props/zones')],
);
add(
  'prop-line-ymin-alone',
  [W('l1', 'line', { props: { yMin: 0 }, tags: { series: ['L.LEVEL'] } })],
  [e0('E_WIDGET_PROP', '/props/yMin')],
);
add(
  'prop-line-labels-too-many',
  [W('l1', 'line', { props: { labels: ['a', 'b'] }, tags: { series: ['L.LEVEL'] } })],
  [e0('E_WIDGET_PROP', '/props/labels')],
);
add(
  'prop-table-columns-dup',
  [W('t1', 'tag-table', { props: { columns: ['label', 'label'] }, tags: { rows: ['L.LEVEL'] } })],
  [e0('E_WIDGET_PROP', '/props/columns')],
);
add(
  'prop-step-zero',
  [W('s1', 'setpoint', { props: { step: 0 }, tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_PROP', '/props/step')],
);
add(
  'prop-setpoint-confirm',
  [W('s1', 'setpoint', { props: { confirm: 'none' }, tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_PROP', '/props/confirm')],
);
add(
  'prop-select-no-table',
  [W('s1', 'select', { tags: { target: 'L.PLAIN' } })],
  [e0('E_WIDGET_PROP', '/props')],
);
add(
  'prop-security-on-display',
  [W('c1', 'card', { tags: { value: 'L.LEVEL' }, security: { minRole: 'operator' } })],
  [e0('E_WIDGET_PROP', '/security')],
);
add(
  'prop-events-on-display',
  [W('c1', 'card', { tags: { value: 'L.LEVEL' }, events: { click: { action: 'closePopup' } } })],
  [e0('E_WIDGET_PROP', '/events')],
);
add('widget-unknown', [W('x1', 'gizmo')], [e0('E_WIDGET_UNKNOWN', '/widget')]);

// ================= Giới hạn, vai trò, xác nhận =================
add(
  'limits-setpoint-min-below',
  [W('s1', 'setpoint', { props: { min: -1, max: 50 }, tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_LIMITS', '/props/min')],
);
add(
  'limits-setpoint-max-above',
  [W('s1', 'setpoint', { props: { min: 0, max: 91 }, tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_LIMITS', '/props/max')],
);
add(
  'limits-slider-min-ge-max',
  [W('s1', 'slider', { props: { min: 10, max: 10 }, tags: { target: 'L.SP' } })],
  [e0('E_WIDGET_LIMITS', '/props/max')],
);
add(
  'limits-gauge-min-ge-max',
  [W('g1', 'gauge', { props: { min: 5, max: 5 }, tags: { value: 'L.LEVEL' } })],
  [e0('E_WIDGET_LIMITS', '/props/max')],
);
add(
  'limits-none-warning',
  [W('s1', 'setpoint', { tags: { target: 'L.FREE' } })],
  [e0('W_WRITE_NO_LIMITS', '/tags/target')],
);
add(
  'limits-widget-only-no-warning',
  [W('s1', 'setpoint', { props: { min: 0, max: 10 }, tags: { target: 'L.FREE' } })],
  [],
);
add(
  'minrole-viewer',
  [W('s1', 'switch', { tags: { target: 'L.CMD' }, security: { minRole: 'viewer' } })],
  [e0('E_WIDGET_MINROLE', '/security/minRole')],
);
add(
  'minrole-unknown',
  [W('s1', 'switch', { tags: { target: 'L.CMD' }, security: { minRole: 'root' } })],
  [e0('E_WIDGET_MINROLE', '/security/minRole')],
);
add(
  'confirm-none-number',
  [
    W('b1', 'button', {
      props: { confirm: 'none' },
      tags: { target: 'L.SP' },
      events: { click: { action: 'write', value: 5 } },
    }),
  ],
  [e0('E_WIDGET_CONFIRM', '/props/confirm'), e0('W_CONFIRM_NONE', '/props/confirm')],
);
add(
  'confirm-none-bool',
  [
    W('b1', 'button', {
      props: { confirm: 'none' },
      tags: { target: 'L.CMD' },
      events: { click: { action: 'toggle' } },
    }),
  ],
  [e0('W_CONFIRM_NONE', '/props/confirm')],
);

// ================= Hành động =================
const act = (name, click, tag, expect, o) =>
  add(
    name,
    [W('b1', 'button', { ...(tag ? { tags: { target: tag } } : {}), events: { click } })],
    expect,
    o,
  );
const click = (sub) => `/events/click${sub}`;
act('action-unknown', { action: 'reboot' }, null, [e0('E_ACTION', click('/action'))]);
act('action-missing', { value: 1 }, null, [e0('E_ACTION', click(''))]);
act('action-write-no-value', { action: 'write' }, 'L.SP', [e0('E_ACTION', click(''))]);
act('action-extra-key', { action: 'toggle', value: true }, 'L.CMD', [
  e0('E_ACTION', click('/value')),
]);
act('action-write-wrong-type', { action: 'write', value: 1 }, 'L.CMD', [
  e0('E_ACTION', click('/value')),
]);
act('action-write-above-limit', { action: 'write', value: 90.5 }, 'L.SP', [
  e0('E_ACTION', click('/value')),
]);
act('action-write-below-limit', { action: 'write', value: -1 }, 'L.SP', [
  e0('E_ACTION', click('/value')),
]);
act('action-write-fraction-int', { action: 'write', value: 1.5 }, 'L.INT', [
  e0('E_ACTION', click('/value')),
]);
act('action-write-string-too-long', { action: 'write', value: 'abcdefghi' }, 'L.TXT', [
  e0('E_ACTION', click('/value')),
]);
for (const [n, v, valid] of [
  [99, 99, false],
  [100, 100, true],
  [10000, 10000, true],
  [10001, 10001, false],
])
  act(
    `action-pulse-duration-${n}`,
    { action: 'pulse', value: true, durationMs: v },
    'L.EXT_NOREAD',
    valid ? [] : [e0('E_ACTION', click('/durationMs'))],
  );
act('action-pulse-value-number', { action: 'pulse', value: 1, durationMs: 500 }, 'L.EXT_NOREAD', [
  e0('E_ACTION', click('/value')),
]);
act(
  'action-pulse-readback-warning',
  { action: 'pulse', value: true, durationMs: 500 },
  'L.EXT_CMD',
  [e0('W_PULSE_READBACK', click(''))],
);
act(
  'action-pulse-internal-no-warning',
  { action: 'pulse', value: true, durationMs: 500 },
  'L.CMD',
  [],
);
act(
  'action-navigate-popup',
  { action: 'navigate', screen: 'pump' },
  null,
  [e0('E_ACTION_TARGET', click('/screen'))],
  {
    files: { 'screens/pump.screen.json': popup() },
  },
);
act(
  'action-popup-screen',
  { action: 'popup', screen: 'other' },
  null,
  [e0('E_ACTION_TARGET', click('/screen'))],
  {
    files: { 'screens/other.screen.json': other() },
  },
);
act('action-navigate-missing', { action: 'navigate', screen: 'nope' }, null, [
  e0('E_ACTION_TARGET', click('/screen')),
]);
act('action-closepopup-on-screen', { action: 'closePopup' }, null, [
  e0('W_ACTION_NOOP', click('')),
]);

// ================= Widget alarm (danh mục 0.4.0, feature 009; ui-alarm.md §13) =================
const AL = (props, extra = {}) =>
  W('al1', 'alarm-list', { width: 640, height: 260, props, ...extra });
const AC = (props, extra = {}) =>
  W('ac1', 'alarm-count', { width: 120, height: 48, props, ...extra });
const badAl = (name, props, code, sub, o = {}) =>
  add(`alarm-list-${name}`, [AL(props, o.item ?? {})], [e0(code, sub)], o.extra);
const badAc = (name, props, code, sub, o = {}) =>
  add(`alarm-count-${name}`, [AC(props, o.item ?? {})], [e0(code, sub)], o.extra);
add('valid-alarm-list-defaults', [AL({})], []);
add('valid-alarm-count-target-none', [AC({ target: { kind: 'none' } })], []);
add('valid-alarm-count-target-screen', [AC({ target: { kind: 'screen', screen: 'other' } })], [], {
  files: { 'screens/other.screen.json': other() },
});
add(
  'valid-alarm-list-columns-all',
  [AL({ columns: ['text', 'time', 'priority', 'area', 'value', 'state', 'ackUser'] })],
  [],
);
add('valid-alarm-list-maxrows-1', [AL({ maxRows: 1 })], []);
add('valid-alarm-list-maxrows-50', [AL({ maxRows: 50 })], []);
badAl('maxrows-0', { maxRows: 0 }, 'E_WIDGET_PROP', '/props/maxRows');
badAl('maxrows-51', { maxRows: 51 }, 'E_WIDGET_PROP', '/props/maxRows');
badAl('maxrows-fraction', { maxRows: 2.5 }, 'E_WIDGET_PROP', '/props/maxRows');
badAl('columns-unknown', { columns: ['time', 'xyz'] }, 'E_WIDGET_PROP', '/props/columns');
badAl('columns-empty', { columns: [] }, 'E_WIDGET_PROP', '/props/columns');
badAl('columns-duplicate', { columns: ['time', 'time'] }, 'E_WIDGET_PROP', '/props/columns');
badAl(
  'columns-8',
  { columns: ['time', 'priority', 'area', 'text', 'value', 'state', 'ackUser', 'time'] },
  'E_WIDGET_PROP',
  '/props/columns',
);
badAl('minpriority-unknown', { minPriority: 'urgent' }, 'E_WIDGET_PROP', '/props/minPriority');
badAl('states-empty', { states: [] }, 'E_WIDGET_PROP', '/props/states');
badAl('states-normal', { states: ['NORMAL'] }, 'E_WIDGET_PROP', '/props/states');
badAl(
  'states-duplicate',
  { states: ['ACTIVE_ACK', 'ACTIVE_ACK'] },
  'E_WIDGET_PROP',
  '/props/states',
);
badAl(
  'areas-65',
  { areas: Array.from({ length: 65 }, (_, i) => `a${i}`) },
  'E_WIDGET_PROP',
  '/props/areas',
);
badAl('areas-item-33', { areas: ['x'.repeat(33)] }, 'E_WIDGET_PROP', '/props/areas');
badAl('areas-not-array', { areas: 'bon' }, 'E_WIDGET_PROP', '/props/areas');
badAl(
  'classes-17',
  { classes: Array.from({ length: 17 }, (_, i) => `c${i}`) },
  'E_WIDGET_PROP',
  '/props/classes',
);
badAl('showack-string', { showAck: 'yes' }, 'E_WIDGET_PROP', '/props/showAck');
badAl('unknown-prop', { foo: 1 }, 'E_WIDGET_PROP', '/props/foo');
badAl('no-tag-slot', {}, 'E_WIDGET_SLOT', '/tags/value', { item: { tags: { value: 'L.LEVEL' } } });
badAl('no-events', {}, 'E_WIDGET_PROP', '/events', {
  item: { events: { click: { action: 'navigate', screen: 'other' } } },
  extra: { files: { 'screens/other.screen.json': other() } },
});
add('alarm-list-too-small', [AL({}, { width: 319 })], [e0('E_ITEM_SIZE', '/width')]);
add(
  'alarm-count-too-small',
  [AC({}, { width: 47, height: 31 })],
  [e0('E_ITEM_SIZE', '/width'), e0('E_ITEM_SIZE', '/height')],
);
badAc('mode-unknown', { mode: 'all' }, 'E_WIDGET_PROP', '/props/mode');
badAc('minpriority-unknown', { minPriority: 'x' }, 'E_WIDGET_PROP', '/props/minPriority');
badAc('target-kind-unknown', { target: { kind: 'popup' } }, 'E_WIDGET_PROP', '/props/target');
badAc('target-screen-missing', { target: { kind: 'screen' } }, 'E_WIDGET_PROP', '/props/target');
badAc('target-extra-field', { target: { kind: 'alarms', x: 1 } }, 'E_WIDGET_PROP', '/props/target');
badAc('target-not-object', { target: 'alarms' }, 'E_WIDGET_PROP', '/props/target');
add(
  'alarm-count-target-screen-too-long',
  [AC({ target: { kind: 'screen', screen: 's'.repeat(65) } })],
  [e0('E_WIDGET_PROP', '/props/target'), e0('E_ACTION_TARGET', '/props/target/screen')],
);
badAc(
  'target-screen-is-popup',
  { target: { kind: 'screen', screen: 'pump' } },
  'E_ACTION_TARGET',
  '/props/target/screen',
  {
    extra: { files: { 'screens/pump.screen.json': popup() } },
  },
);
badAc(
  'target-screen-missing-file',
  { target: { kind: 'screen', screen: 'nope' } },
  'E_ACTION_TARGET',
  '/props/target/screen',
);

// ================= Ghi ra đĩa =================
for (const d of readdirSync(here))
  if (statSync(join(here, d)).isDirectory()) rmSync(join(here, d), { recursive: true });
for (const c of cases) {
  const dir = join(here, c.name);
  mkdirSync(dir, { recursive: true });
  const screen = {
    schemaVersion: V,
    id: 'main',
    name: 'Main',
    size: { width: 1280, height: 720 },
    items: c.items,
  };
  const files = {
    'screen.json': screen,
    'tags.json': tags(),
    'connections.json': connections(),
    'value-tables/TrangThaiBom.json': valueTable(),
    ...(c.files ?? {}),
  };
  for (const [rel, v] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), json(v));
  }
  writeFileSync(join(dir, 'expect.json'), json(c.expect));
}

// ================= Feature 010 (T076): ca widget lịch sử, project 0.6.0 có logging.json =================
const V06 = '0.6.0';
const to06 = (o) => ({ ...o, schemaVersion: V06 });
const history = historyCases();
for (const c of history) {
  const dir = join(here, c.name);
  mkdirSync(dir, { recursive: true });
  const project = {
    format: 'matscada-project',
    schemaVersion: V06,
    projectId: 'catalog-vector-06',
    projectName: 'Catalog vector 0.6',
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.9.0',
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    valueTables: ['TrangThaiBom'],
    ...(c.noLogging ? {} : { loggingFile: 'logging.json' }),
    maxClients: 10,
  };
  const files = {
    'project.json': project,
    'screen.json': to06({
      id: 'main',
      name: 'Main',
      size: { width: 1280, height: 720 },
      items: c.items,
    }),
    'tags.json': to06(tags()),
    'connections.json': to06(connections()),
    'value-tables/TrangThaiBom.json': to06(valueTable()),
    ...(c.noLogging ? {} : { 'logging.json': loggingFor(V06) }),
  };
  for (const [rel, v] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), json(v));
  }
  writeFileSync(join(dir, 'expect.json'), json(c.expect));
}
console.log(`${cases.length + history.length} vector danh mục widget trong ${here}`);
