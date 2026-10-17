// Ca `v04-*` của bộ vector project (feature 008, specs/008-svg-import-binding/contracts/project-format-0.4.md §6, §8).
// Được generate.mjs nạp: `cases04()` trả các ca nhỏ (commit), `large04()` trả các ca lớn (chỉ sinh vào out/ lúc
// chạy test: `node tests/project-vectors/generate.mjs --out04`).
//
// ĐỊNH DẠNG CA (cho bản TS `vectors-04.test.ts` và bản C++ `vectors_04_test.cpp`): mỗi ca là một thư mục project
// 0.4 + `expected.json`:
//   { valid, errors: [mã lỗi], warnings: [mã cảnh báo] (ca hợp lệ luôn có, kể cả []), issues?: [{code, file, path}], files? }
//   - `errors`, `warnings`: TẬP mã (so không phân biệt thứ tự và số lần); `issues`: các {code, file, path} phải CÓ MẶT
//     (chứa, không cần liệt kê hết; lỗi E_SCHEMA, E_JSON, E_FILE_MISSING không ghi `issues` vì hai bộ kiểm tra schema
//     đặt `path` khác nhau); ca hợp lệ có `files` (tập file) và `digest`.
//   - Mã chỉ ở bản TS (E_SVG_*, W_SVG_HEAVY, W_UID_NOT_IN_SVG, W_BIND_ELEMENT_KIND, W_BIND_CLIP_EXISTS) KHÔNG xuất hiện ở đây
//     (cần nội dung SVG; test riêng `rules-04.test.ts`).
//
// QUY ƯỚC `path` (JSON Pointer; file là file binding `screens/main.svg1.bindings.json` hoặc `screens/main.screen.json`):
//   - binding thứ j của phần tử i: bp = `/elements/i/bindings/j`.
//   - E_BIND_TRANSFORM: `bp/transform/kind`.        E_BIND_PARAM: `bp/<khóa tham số>`; khóa con của `format`: `bp/format/<khóa>`;
//     `format` không phải đối tượng: `bp/format`; thiếu `color` khi `mode` = fill|stroke: `bp/color`.
//   - E_RANGE: số khoảng ngoài 1-64: `bp/transform/ranges`; khoảng thứ k sai (thiếu cả from và to; from >= to; chồng với một
//     khoảng ĐỨNG TRƯỚC nó trong file, so từng cặp như bảng giá trị): `bp/transform/ranges/k` (k là khoảng đứng sau).
//   - E_DUP_BINDING: id trùng trong file: `bp/id`; hai binding cùng nhóm đích trên một phần tử: `bp/target` của binding sau.
//   - E_TYPE_MISMATCH: kiểu Tag không hợp đích: `bp/source/tagId`; hợp phép biến đổi: `bp/transform`; `equals` sai kiểu:
//     `bp/transform/cases`; `output` không hợp đích: `bp/transform/output`.
//   - sự kiện của phần tử i: ep = `/elements/i/events/click`; khóa sự kiện lạ: `/elements/i/events/<khóa>`; E_EVENT_ACTION ở
//     trường thừa: `ep/<trường>`; thiếu trường bắt buộc: `ep`; E_EVENT_TAG: `ep/tag` (Tag không hợp) hoặc `ep/value`
//     (giá trị sai kiểu/ngoài limits); E_EVENT_TARGET: `ep/screen`; E_EVENT_CONFIRM: `ep/confirm`; E_EVENT_MINROLE: `ep/minRole`;
//     cảnh báo: W_EVENT_CONFIRM_NONE `ep/confirm`, W_EVENT_PULSE_READBACK `ep`.
//   - E_LIMIT, W_ANIM_MANY, E_SCREEN_TAGS: `/items` của file màn hình.   W_BLINK_ONLY: `bp`.
//   - E_REF_UID: `/elements/i/elementUid` của file binding.
//
// Mỗi ca: [tên, hàm sửa base04, mã lỗi (tập), mã cảnh báo (tập, tùy chọn), thêm { issues }].
import { base03 } from './v03.mjs';

const V = '0.4.0';
const MS = 'screens/main.screen.json';
const PS = 'screens/pump.screen.json';
const PJ = 'project.json';
const MB = 'screens/main.svg1.bindings.json';
const MSVG = 'graphics/main.svg';
const OLD_MB = 'screens/main.bindings.json';
const OLD_SVG = 'screens/main.svg';
const TAGS = 'tags.json';

/** Project 0.4 hợp lệ: như base03 (main có item svg `svg1` + widget, pump là popup) với tên file kiểu 0.4. */
export function base04() {
  const f = base03();
  f[MSVG] = f[OLD_SVG];
  delete f[OLD_SVG];
  f[MB] = f[OLD_MB];
  delete f[OLD_MB];
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined) v.schemaVersion = V;
  f[PJ].projectId = 'vector04';
  f[PJ].projectName = 'Vector 0.4';
  f[PJ].minRuntimeVersion = '0.7.0';
  const it = f[MS].items[0];
  it.svgFile = MSVG;
  it.bindingFile = MB;
  return f;
}

const at = (code, path, file = MS) => ({ code, file, path });
const atb = (code, path) => at(code, path, MB);
const BP = '/elements/0/bindings/0';
const EP = '/elements/0/events/click';
const bp = (sub = '') => `${BP}${sub}`;
const ep = (sub = '') => `${EP}${sub}`;
const pad = (i, w = 4) => String(i).padStart(w, '0');

// Tag của base03
const LV = 'TANK01.LEVEL'; // FLOAT32, chỉ đọc
const SP = 'TANK01.SP'; // FLOAT32, RW, limits 0-90
const RUN = 'PUMP01.RUN_CMD'; // BOOL, RW, readback false
const FAULT = 'PUMP01.FAULT'; // BOOL, chỉ đọc
const STATE = 'PUMP01.STATE'; // INT16, bảng TrangThaiBom
const NAME = 'PUMP01.NAME'; // STRING, chỉ đọc
const HIGH = 'TANK01.HIGH'; // BOOL, tính toán
const WAVE = 'DEMO.WAVE'; // FLOAT64, mô phỏng sine (không nhập tay)
const SET = 'DEMO.SET'; // INT16, mô phỏng nhập tay, limits -100..100
const NOTE = 'NOTE.TEXT'; // STRING, nội bộ RW, maxLength 8
const CMD2 = 'PUMP02.CMD'; // BOOL, RW, đọc lại (mặc định)

const D = { kind: 'direct' };
const LS = (inMin, inMax, outMin, outMax, clamp) => ({
  kind: 'linearScale',
  inMin,
  inMax,
  outMin,
  outMax,
  ...(clamp === undefined ? {} : { clamp }),
});
const LIN = LS(0, 100, 0, 100, true);
const DM = (cases, def) => ({
  kind: 'discreteMap',
  cases,
  ...(def === undefined ? {} : { default: def }),
});
const RM = (ranges, def) => ({
  kind: 'rangeMap',
  ranges,
  ...(def === undefined ? {} : { default: def }),
});
const BOOLMAP = (a, b) =>
  DM([
    { equals: true, value: a },
    { equals: false, value: b },
  ]);
const COLOR_RANGES = [
  { to: 20, value: '#d32f2f' },
  { from: 20, to: 80, value: '#1e88e5' },
  { from: 80, value: '#d32f2f' },
];
const NUM_RANGES = [
  { to: 20, value: 0 },
  { from: 20, value: 1 },
];

const b = (id, target, tagId, transform, extra = {}) => ({
  id,
  target,
  source: { type: 'tag', tagId },
  transform,
  ...extra,
});
/** Binding của phần tử `el_aaa` (thay mọi phần tử của file binding). */
const setB = (f, ...bindings) => {
  f[MB].elements = [{ elementUid: 'el_aaa', bindings }];
};
/** Sự kiện click của `el_aaa` (không binding). */
const setE = (f, click) => {
  f[MB].elements = [{ elementUid: 'el_aaa', events: { click } }];
};
const rangesN = (n) =>
  Array.from({ length: n }, (_, i) => ({ from: i, to: i + 1, value: `v${i}` }));

/** [tên, hàm sửa base, mã lỗi, mã cảnh báo (tùy chọn), thêm (tùy chọn)] */
export function cases04() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) =>
    C.push([`v04-${name}`, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([`v04-${name}`, mutate, errors, warnings, extra]);
  const iss = (...issues) => ({ issues });
  /** Ca một binding của `el_aaa`. */
  const okB = (name, binding, warnings = []) => ok(name, (f) => setB(f, binding), warnings);
  const badB = (name, binding, errors, issues, warnings) =>
    bad(
      name,
      (f) => setB(f, binding),
      errors,
      warnings,
      issues === undefined ? undefined : iss(...issues),
    );
  /** Ca sự kiện click. */
  const okE = (name, click, warnings = [], mutate = () => {}) =>
    ok(
      name,
      (f) => {
        mutate(f);
        setE(f, click);
      },
      warnings,
    );
  const badE = (name, click, errors, issues, warnings, mutate = () => {}) =>
    bad(
      name,
      (f) => {
        mutate(f);
        setE(f, click);
      },
      errors,
      warnings,
      issues === undefined ? undefined : iss(...issues),
    );

  // ================= Hợp lệ: nền và từng đích =================
  ok('valid-full', () => {});
  okB(
    'valid-text-direct-format',
    b('b1', 'text.content', LV, D, {
      format: { decimals: 2, prefix: 'L=', suffix: ' %', unitFromTag: true },
    }),
  );
  okB('valid-text-direct-string-tag', b('b1', 'text.content', NAME, D));
  okB('valid-text-direct-bool-tag', b('b1', 'text.content', FAULT, D));
  okB(
    'valid-text-discrete',
    b(
      'b1',
      'text.content',
      FAULT,
      DM(
        [
          { equals: true, value: 'Loi' },
          { equals: false, value: 'OK' },
        ],
        '--',
      ),
    ),
  );
  okB(
    'valid-text-valuetable',
    b('b1', 'text.content', STATE, { kind: 'valueTable', output: 'text' }),
  );
  okB(
    'valid-text-rangemap',
    b(
      'b1',
      'text.content',
      LV,
      RM(
        [
          { to: 20, value: 'Thap' },
          { from: 20, to: 80, value: 'Vua' },
          { from: 80, value: 'Cao' },
        ],
        '--',
      ),
    ),
  );
  okB('valid-fill-discrete-bool', b('b1', 'style.fill', FAULT, BOOLMAP('#ef4444', '#64748b')));
  okB(
    'valid-fill-discrete-string',
    b('b1', 'style.fill', NAME, DM([{ equals: 'run', value: '#2e7d32' }], '#808080')),
  );
  okB(
    'valid-fill-valuetable',
    b('b1', 'style.fill', STATE, { kind: 'valueTable', output: 'color' }),
  );
  okB('valid-fill-rangemap', b('b1', 'style.fill', LV, RM(COLOR_RANGES, '#9e9e9e')));
  okB(
    'valid-fill-rangemap-empty-string',
    b(
      'b1',
      'style.fill',
      LV,
      RM([
        { to: 20, value: '' },
        { from: 20, value: '#1e88e5' },
      ]),
    ),
  );
  okB('valid-stroke-rangemap', b('b1', 'style.stroke', LV, RM(COLOR_RANGES)));
  okB('valid-stroke-discrete', b('b1', 'style.stroke', FAULT, BOOLMAP('#ef4444', '#64748b')));
  okB(
    'valid-stroke-valuetable-table',
    b('b1', 'style.stroke', STATE, { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' }),
  );
  okB('valid-opacity-direct', b('b1', 'style.opacity', LV, D));
  okB('valid-opacity-linear', b('b1', 'style.opacity', LV, LS(0, 100, 0, 1, true)));
  okB('valid-opacity-discrete-bool', b('b1', 'style.opacity', FAULT, BOOLMAP(1, 0.3)));
  okB('valid-opacity-rangemap', b('b1', 'style.opacity', LV, RM(NUM_RANGES)));
  okB('valid-visibility-direct-bool', b('b1', 'style.visibility', FAULT, D));
  okB(
    'valid-visibility-discrete-number',
    b('b1', 'style.visibility', STATE, DM([{ equals: 0, value: 'hidden' }], 'visible')),
  );
  okB(
    'valid-visibility-discrete-string',
    b('b1', 'style.visibility', NAME, DM([{ equals: 'x', value: 'hidden' }], 'visible')),
  );
  okB(
    'valid-visibility-rangemap',
    b('b1', 'style.visibility', LV, RM([{ from: 10, value: 'visible' }], 'hidden')),
  );
  okB('valid-rotate-direct', b('b1', 'transform.rotate', LV, D));
  okB(
    'valid-rotate-linear-pivot',
    b('b1', 'transform.rotate', LV, LS(0, 100, 0, 270, true), { pivot: [0, 1] }),
  );
  okB(
    'valid-rotate-discrete',
    b('b1', 'transform.rotate', STATE, DM([{ equals: 1, value: 90 }], 0)),
  );
  okB('valid-rotate-rangemap', b('b1', 'transform.rotate', LV, RM(NUM_RANGES)));
  okB('valid-spin-number', b('b1', 'transform.rotate', LV, D, { animation: 'spin' }));
  okB(
    'valid-spin-bool-reverse',
    b('b1', 'transform.rotate', FAULT, D, { animation: 'spin', reverse: true, pivot: [0.5, 0.5] }),
  );
  okB(
    'valid-spin-linear',
    b('b1', 'transform.rotate', LV, LS(0, 100, 0, 600, true), { animation: 'spin' }),
  );
  okB('valid-translate-x-linear', b('b1', 'transform.translateX', LV, LS(0, 100, 0, 200, true)));
  okB('valid-translate-y-direct', b('b1', 'transform.translateY', LV, D));
  okB('valid-translate-x-rangemap', b('b1', 'transform.translateX', LV, RM(NUM_RANGES)));
  okB(
    'valid-scale-linear-axis-x-pivot',
    b('b1', 'transform.scale', LV, LS(0, 100, 0.5, 2, true), { axis: 'x', pivot: [1, 0] }),
  );
  okB('valid-scale-axis-y', b('b1', 'transform.scale', LV, D, { axis: 'y' }));
  okB(
    'valid-scale-axis-xy-discrete',
    b('b1', 'transform.scale', STATE, DM([{ equals: 1, value: 2 }], 1), { axis: 'xy' }),
  );
  okB('valid-level-direct', b('b1', 'geometry.levelPercent', LV, D));
  for (const d of ['up', 'down', 'left', 'right']) {
    okB(`valid-level-direction-${d}`, b('b1', 'geometry.levelPercent', LV, LIN, { direction: d }));
    okB(
      `valid-clip-level-direction-${d}`,
      b('b1', 'geometry.clipLevel', LV, LIN, { direction: d }),
    );
  }
  okB('valid-clip-level-direct', b('b1', 'geometry.clipLevel', LV, D));
  ok('valid-blink-bool-with-fill', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', FAULT, D),
      b('b2', 'style.fill', FAULT, BOOLMAP('#ef4444', '#64748b')),
    ),
  );
  ok('valid-blink-with-text-same-tag', (f) =>
    setB(f, b('b1', 'effect.blink', FAULT, D), b('b2', 'text.content', FAULT, D)),
  );
  ok('valid-blink-with-stroke-same-tag', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', FAULT, D),
      b('b2', 'style.stroke', FAULT, BOOLMAP('#ef4444', '#64748b')),
    ),
  );
  okB('valid-blink-only-warns', b('b1', 'effect.blink', FAULT, D), ['W_BLINK_ONLY']);
  okB('valid-blink-number-only-warns', b('b1', 'effect.blink', LV, D, { period: 500 }), [
    'W_BLINK_ONLY',
  ]);
  ok(
    'warn-blink-other-tag-only',
    (f) =>
      setB(
        f,
        b('b1', 'effect.blink', FAULT, D),
        b('b2', 'style.fill', HIGH, BOOLMAP('#ef4444', '#64748b')),
      ),
    ['W_BLINK_ONLY'],
    iss(atb('W_BLINK_ONLY', bp())),
  );
  ok('valid-blink-fill-mode-color', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', FAULT, D, { mode: 'fill', color: '#ff0000', period: 800 }),
      b('b2', 'text.content', FAULT, D),
    ),
  );
  ok('valid-blink-stroke-mode-color-name', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', FAULT, D, { mode: 'stroke', color: 'red' }),
      b('b2', 'text.content', FAULT, D),
    ),
  );
  ok('valid-blink-discrete', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', STATE, DM([{ equals: 2, value: true }], false)),
      b('b2', 'text.content', STATE, D),
    ),
  );
  ok('valid-blink-rangemap', (f) =>
    setB(
      f,
      b('b1', 'effect.blink', LV, RM([{ from: 90, value: true }], false)),
      b('b2', 'text.content', LV, D),
    ),
  );
  okB('valid-flow-bool', b('b1', 'effect.flow', RUN, D, { dash: '12 8', speed: 80 }));
  okB('valid-flow-linear', b('b1', 'effect.flow', LV, LS(0, 100, 0, 300, true)));
  okB('valid-flow-discrete', b('b1', 'effect.flow', STATE, DM([{ equals: 1, value: 60 }], 0)));
  okB(
    'valid-flow-rangemap-by-sign',
    b(
      'b1',
      'effect.flow',
      LV,
      RM([
        { to: 0, value: -60 },
        { from: 0, value: 60 },
      ]),
      { byValueSign: true, reverse: true },
    ),
  );
  okB('valid-flow-dash-decimals', b('b1', 'effect.flow', RUN, D, { dash: '4.5 3' }));
  ok('valid-combined-rotate-translate-scale-fill', (f) =>
    setB(
      f,
      b('b1', 'transform.rotate', LV, D, { pivot: [0.5, 0.5] }),
      b('b2', 'transform.translateX', LV, LIN),
      b('b3', 'transform.translateY', LV, LIN),
      b('b4', 'transform.scale', LV, LS(0, 100, 1, 2, true)),
      b('b5', 'style.fill', LV, RM(COLOR_RANGES)),
    ),
  );
  ok('valid-combined-spin-translate-flow-level', (f) =>
    setB(
      f,
      b('b1', 'transform.rotate', RUN, D, { animation: 'spin' }),
      b('b2', 'transform.translateX', LV, LIN),
      b('b3', 'effect.flow', RUN, D),
      b('b4', 'geometry.levelPercent', LV, D),
    ),
  );
  // 12 nhóm đích trên một phần tử; blink cùng Tag với visibility (không phải chữ, màu nền, màu viền): W_BLINK_ONLY
  ok(
    'valid-combined-all-groups',
    (f) =>
      setB(
        f,
        b('b01', 'text.content', LV, D),
        b('b02', 'style.fill', LV, RM(COLOR_RANGES)),
        b('b03', 'style.stroke', LV, RM(COLOR_RANGES)),
        b('b04', 'style.opacity', LV, LIN),
        b('b05', 'style.visibility', FAULT, D),
        b('b06', 'transform.rotate', LV, D),
        b('b07', 'transform.translateX', LV, LIN),
        b('b08', 'transform.translateY', LV, LIN),
        b('b09', 'transform.scale', LV, LS(0, 100, 1, 2, true)),
        b('b10', 'geometry.clipLevel', LV, LIN),
        b('b11', 'effect.blink', FAULT, D),
        b('b12', 'effect.flow', RUN, D),
      ),
    ['W_BLINK_ONLY'],
  );
  ok('valid-element-events-only', (f) => setE(f, { action: 'closePopup' }));
  ok('valid-element-bindings-and-events', (f) => {
    f[MB].elements = [
      {
        elementUid: 'el_aaa',
        bindings: [b('b1', 'style.fill', FAULT, BOOLMAP('#ef4444', '#64748b'))],
        events: { click: { action: 'popup', screen: 'pump' } },
      },
    ];
  });
  ok('valid-two-elements-binding-and-event', (f) => {
    f[MB].elements = [
      { elementUid: 'el_aaa', bindings: [b('b1', 'geometry.levelPercent', LV, D)] },
      { elementUid: 'el_bbb', events: { click: { action: 'toggle', tag: RUN } } },
    ];
  });
  ok('valid-one-element-11-bindings', (f) => {
    const targets = [
      ['style.fill', LV, RM(COLOR_RANGES)],
      ['style.stroke', LV, RM(COLOR_RANGES)],
      ['style.opacity', LV, LIN],
      ['style.visibility', FAULT, D],
      ['text.content', LV, D],
      ['transform.rotate', LV, D],
      ['transform.translateX', LV, LIN],
      ['transform.translateY', LV, LIN],
      ['transform.scale', LV, LS(0, 100, 1, 2, true)],
      ['geometry.levelPercent', LV, D],
      ['effect.flow', RUN, D],
    ];
    setB(f, ...targets.map(([t, tag, tr], i) => b(`b${pad(i, 2)}`, t, tag, tr)));
  });

  // ---- biên tham số hợp lệ ----
  for (const p of [400, 1000, 5000])
    ok(`valid-param-period-${p}`, (f) =>
      setB(f, b('b1', 'effect.blink', FAULT, D, { period: p }), b('b2', 'text.content', FAULT, D)),
    );
  for (const s of [0, 0.5, 300])
    okB(
      `valid-param-speed-${String(s).replace('.', '_')}`,
      b('b1', 'effect.flow', RUN, D, { speed: s }),
    );
  for (const pv of [
    [0, 0],
    [1, 1],
    [0.25, 0.75],
  ])
    okB(
      `valid-param-pivot-${pv.join('-').replace(/\./g, '_')}`,
      b('b1', 'transform.rotate', LV, D, { pivot: pv }),
    );
  for (const m of [0, 0.9])
    ok(`valid-param-minopacity-${String(m).replace('.', '_')}`, (f) =>
      setB(
        f,
        b('b1', 'effect.blink', FAULT, D, { minOpacity: m }),
        b('b2', 'text.content', FAULT, D),
      ),
    );
  for (const d of [0, 6])
    okB(`valid-param-decimals-${d}`, b('b1', 'text.content', LV, D, { format: { decimals: d } }));
  okB(
    'valid-param-prefix-16',
    b('b1', 'text.content', LV, D, { format: { prefix: 'p'.repeat(16) } }),
  );
  okB(
    'valid-param-suffix-16',
    b('b1', 'text.content', LV, D, { format: { suffix: 's'.repeat(16) } }),
  );
  okB('valid-param-format-empty', b('b1', 'text.content', LV, D, { format: {} }));
  okB('valid-param-dash-single', b('b1', 'effect.flow', RUN, D, { dash: '10' }));
  okB(
    'valid-param-dash-eight-numbers',
    b('b1', 'effect.flow', RUN, D, { dash: '1 2 3 4 5 6 7 8' }),
  );
  for (const n of [1, 63, 64])
    okB(`valid-rangemap-${n}-ranges`, b('b1', 'text.content', LV, RM(rangesN(n))));
  okB(
    'valid-rangemap-touching',
    b(
      'b1',
      'text.content',
      LV,
      RM([
        { from: 0, to: 5, value: 'a' },
        { from: 5, to: 10, value: 'b' },
      ]),
    ),
  );
  okB(
    'valid-rangemap-unordered',
    b(
      'b1',
      'text.content',
      LV,
      RM([
        { from: 5, to: 10, value: 'b' },
        { from: 0, to: 5, value: 'a' },
      ]),
    ),
  );
  okB(
    'valid-rangemap-half-open-both',
    b(
      'b1',
      'text.content',
      LV,
      RM([
        { to: 0, value: 'neg' },
        { from: 0, value: 'pos' },
      ]),
    ),
  );
  okB(
    'valid-rangemap-bool-value',
    b('b1', 'effect.flow', LV, RM([{ from: 1, value: true }], false)),
  );

  // ================= Hợp lệ: sự kiện =================
  okE('valid-event-write-bool', { action: 'write', tag: RUN, value: true });
  okE('valid-event-write-number', { action: 'write', tag: SP, value: 50 });
  okE('valid-event-write-number-limit-max', { action: 'write', tag: SP, value: 90 });
  okE('valid-event-write-number-limit-min', { action: 'write', tag: SP, value: 0 });
  okE('valid-event-write-string-maxlen', { action: 'write', tag: NOTE, value: 'abcdefgh' });
  okE('valid-event-write-manual-simulation', { action: 'write', tag: SET, value: -100 });
  okE('valid-event-write-confirm-always', {
    action: 'write',
    tag: SP,
    value: 10,
    confirm: 'always',
  });
  okE('valid-event-toggle', { action: 'toggle', tag: RUN });
  okE('valid-event-toggle-engineer', { action: 'toggle', tag: RUN, minRole: 'engineer' });
  okE('valid-event-toggle-administrator', {
    action: 'toggle',
    tag: RUN,
    minRole: 'administrator',
    label: 'Doi trang thai',
  });
  okE(
    'valid-event-confirm-none-bool',
    { action: 'write', tag: RUN, value: false, confirm: 'none' },
    ['W_EVENT_CONFIRM_NONE'],
    undefined,
  );
  okE('valid-event-pulse', { action: 'pulse', tag: RUN, value: true, durationMs: 500 });
  for (const d of [100, 10000])
    okE(`valid-event-pulse-duration-${d}`, {
      action: 'pulse',
      tag: RUN,
      value: true,
      durationMs: d,
    });
  okE('valid-event-pulse-false', { action: 'pulse', tag: RUN, value: false, durationMs: 200 });
  okE(
    'valid-event-pulse-readback-warns',
    { action: 'pulse', tag: CMD2, value: true, durationMs: 500 },
    ['W_EVENT_PULSE_READBACK'],
  );
  okE('valid-event-navigate', { action: 'navigate', screen: 'main' });
  okE('valid-event-popup', { action: 'popup', screen: 'pump' });
  okE('valid-event-close-popup', { action: 'closePopup' });
  okE('valid-event-label-80', { action: 'closePopup', label: 'L'.repeat(80) });
  okE('valid-event-label-unicode', { action: 'popup', screen: 'pump', label: 'Mở chi tiết bơm 1' });
  okE('valid-event-navigate-label', {
    action: 'navigate',
    screen: 'main',
    label: 'Về màn hình chính',
  });

  // ================= Không hợp lệ: schema =================
  bad(
    'invalid-schema-element-no-bindings-no-events',
    (f) => (f[MB].elements = [{ elementUid: 'el_aaa' }]),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-element-empty-bindings',
    (f) => (f[MB].elements = [{ elementUid: 'el_aaa', bindings: [] }]),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-element-17-bindings',
    (f) => {
      f[MB].elements = [
        {
          elementUid: 'el_aaa',
          bindings: Array.from({ length: 17 }, (_, i) => b(`b${pad(i, 2)}`, 'text.content', LV, D)),
        },
      ];
    },
    ['E_SCHEMA'],
  );
  bad('invalid-schema-unknown-target', (f) => setB(f, b('b1', 'effect.glow', LV, D)), ['E_SCHEMA']);
  bad(
    'invalid-schema-unknown-param',
    (f) => setB(f, b('b1', 'style.opacity', LV, D, { glow: 1 })),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-rangemap-no-ranges',
    (f) => setB(f, b('b1', 'style.opacity', LV, { kind: 'rangeMap' })),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-rangemap-no-value',
    (f) =>
      setB(f, b('b1', 'style.opacity', LV, { kind: 'rangeMap', ranges: [{ from: 0, to: 1 }] })),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-rangemap-string-from',
    (f) =>
      setB(
        f,
        b('b1', 'style.opacity', LV, { kind: 'rangeMap', ranges: [{ from: '0', value: 1 }] }),
      ),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-events-not-object',
    (f) => (f[MB].elements = [{ elementUid: 'el_aaa', events: 'click' }]),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-element-extra-key',
    (f) =>
      (f[MB].elements = [
        { elementUid: 'el_aaa', events: { click: { action: 'closePopup' } }, name: 'x' },
      ]),
    ['E_SCHEMA'],
  );
  bad(
    'invalid-schema-uid-pattern',
    (f) =>
      (f[MB].elements = [{ elementUid: 'EL_AAA', bindings: [b('b1', 'text.content', LV, D)] }]),
    ['E_SCHEMA'],
  );

  // ================= Không hợp lệ: phép biến đổi =================
  const BT = (name, target, tag, transform, extra) =>
    badB(
      name,
      b('b1', target, tag, transform, extra),
      ['E_BIND_TRANSFORM'],
      [atb('E_BIND_TRANSFORM', bp('/transform/kind'))],
    );
  BT('invalid-transform-linear-on-fill', 'style.fill', LV, LIN);
  // `direct` cho màu và hiện ẩn (Tag STRING) giữ từ 0.2 để nâng cấp 0.3 -> 0.4 không đổi binding: xem ca valid-*-direct-string-tag
  okB('valid-fill-direct-string-tag', b('b1', 'style.fill', NAME, D));
  okB('valid-stroke-direct-string-tag', b('b1', 'style.stroke', NAME, D));
  okB('valid-visibility-direct-string-tag', b('b1', 'style.visibility', NAME, D));
  BT('invalid-transform-linear-on-text', 'text.content', LV, LIN);
  BT('invalid-transform-valuetable-on-opacity', 'style.opacity', STATE, {
    kind: 'valueTable',
    output: 'text',
  });
  BT('invalid-transform-linear-on-visibility', 'style.visibility', LV, LIN);
  BT('invalid-transform-valuetable-on-rotate', 'transform.rotate', STATE, {
    kind: 'valueTable',
    output: 'text',
  });
  BT('invalid-transform-rangemap-on-level', 'geometry.levelPercent', LV, RM(NUM_RANGES));
  BT(
    'invalid-transform-discrete-on-level',
    'geometry.levelPercent',
    STATE,
    DM([{ equals: 1, value: 50 }]),
  );
  BT('invalid-transform-rangemap-on-clip-level', 'geometry.clipLevel', LV, RM(NUM_RANGES));
  BT(
    'invalid-transform-discrete-on-clip-level',
    'geometry.clipLevel',
    STATE,
    DM([{ equals: 1, value: 50 }]),
  );
  BT('invalid-transform-linear-on-blink', 'effect.blink', LV, LIN);
  BT('invalid-transform-valuetable-on-flow', 'effect.flow', STATE, {
    kind: 'valueTable',
    output: 'text',
  });
  BT('invalid-transform-valuetable-on-scale', 'transform.scale', STATE, {
    kind: 'valueTable',
    output: 'text',
  });
  badB(
    'invalid-target-component-state',
    b('b1', 'component.state', FAULT, D),
    ['E_TARGET_UNSUPPORTED'],
    [atb('E_TARGET_UNSUPPORTED', bp('/target'))],
  );
  badB(
    'invalid-transform-expression',
    b('b1', 'text.content', LV, { kind: 'expression', source: 'x' }),
    ['E_TRANSFORM_UNSUPPORTED'],
    [atb('E_TRANSFORM_UNSUPPORTED', bp('/transform/kind'))],
  );
  badB(
    'invalid-transform-format-kind',
    b('b1', 'text.content', LV, { kind: 'format' }),
    ['E_TRANSFORM_UNSUPPORTED'],
    [atb('E_TRANSFORM_UNSUPPORTED', bp('/transform/kind'))],
  );

  // ================= Không hợp lệ: tham số =================
  const BPARAM = (name, target, tag, transform, extra, sub, warnings) =>
    badB(
      name,
      b('b1', target, tag, transform, extra),
      ['E_BIND_PARAM'],
      [atb('E_BIND_PARAM', bp(sub))],
      warnings,
    );
  const BL = (name, extra, sub, tag = FAULT) =>
    BPARAM(name, 'effect.blink', tag, D, extra, sub, undefined);
  for (const p of [399, 5001, 0, -1])
    BL(`invalid-param-period-${String(p).replace('-', 'neg')}`, { period: p }, '/period');
  BL('invalid-param-period-fraction', { period: 1000.5 }, '/period');
  BL('invalid-param-period-string', { period: '1000' }, '/period');
  BL('invalid-param-minopacity-0_91', { minOpacity: 0.91 }, '/minOpacity');
  BL('invalid-param-minopacity-negative', { minOpacity: -0.1 }, '/minOpacity');
  BL('invalid-param-minopacity-string', { minOpacity: 'x' }, '/minOpacity');
  BL('invalid-param-mode-unknown', { mode: 'glow' }, '/mode');
  BL('invalid-param-mode-fill-no-color', { mode: 'fill' }, '/color');
  BL('invalid-param-mode-stroke-no-color', { mode: 'stroke' }, '/color');
  BL('invalid-param-color-short', { mode: 'fill', color: '#12' }, '/color');
  BL('invalid-param-color-not-string', { mode: 'fill', color: 5 }, '/color');
  BL('invalid-param-color-injection', { mode: 'fill', color: 'red;background:url(x)' }, '/color');
  const BR = (name, extra, sub, target = 'transform.rotate') =>
    BPARAM(name, target, LV, D, extra, sub, undefined);
  BR('invalid-param-pivot-x-negative', { pivot: [-0.01, 0] }, '/pivot');
  BR('invalid-param-pivot-y-over-1', { pivot: [0, 1.01] }, '/pivot');
  BR('invalid-param-pivot-both-2', { pivot: [2, 2] }, '/pivot');
  BR('invalid-param-pivot-length-1', { pivot: [0.5] }, '/pivot');
  BR('invalid-param-pivot-length-3', { pivot: [0.5, 0.5, 0.5] }, '/pivot');
  BR('invalid-param-pivot-not-array', { pivot: 0.5 }, '/pivot');
  BR('invalid-param-pivot-string-item', { pivot: ['a', 0.5] }, '/pivot');
  BR(
    'invalid-param-pivot-on-scale-out-of-range',
    { pivot: [1.5, 0.5] },
    '/pivot',
    'transform.scale',
  );
  BR('invalid-param-axis-unknown', { axis: 'z' }, '/axis', 'transform.scale');
  BR('invalid-param-axis-not-string', { axis: 1 }, '/axis', 'transform.scale');
  BR('invalid-param-animation-unknown', { animation: 'orbit' }, '/animation');
  BR('invalid-param-reverse-without-spin', { reverse: true }, '/reverse');
  BR('invalid-param-reverse-not-boolean', { animation: 'spin', reverse: 'yes' }, '/reverse');
  BR(
    'invalid-param-direction-unknown',
    { direction: 'diagonal' },
    '/direction',
    'geometry.levelPercent',
  );
  BR(
    'invalid-param-direction-clip-unknown',
    { direction: 'in' },
    '/direction',
    'geometry.clipLevel',
  );
  const BF = (name, extra, sub) => BPARAM(name, 'effect.flow', RUN, D, extra, sub, undefined);
  BF('invalid-param-speed-301', { speed: 301 }, '/speed');
  BF('invalid-param-speed-negative', { speed: -1 }, '/speed');
  BF('invalid-param-speed-string', { speed: '60' }, '/speed');
  BF('invalid-param-dash-letters', { dash: '12x8' }, '/dash');
  BF('invalid-param-dash-zeros', { dash: '0 0' }, '/dash');
  BF('invalid-param-dash-empty', { dash: '' }, '/dash');
  BF('invalid-param-dash-nine-numbers', { dash: '1 2 3 4 5 6 7 8 9' }, '/dash');
  BF('invalid-param-dash-negative', { dash: '-4 4' }, '/dash');
  BF('invalid-param-dash-comma', { dash: '4,4' }, '/dash');
  BF('invalid-param-dash-not-string', { dash: [4, 4] }, '/dash');
  BF('invalid-param-by-value-sign-not-boolean', { byValueSign: 1 }, '/byValueSign');
  BF('invalid-param-flow-reverse-not-boolean', { reverse: 'no' }, '/reverse');
  const BX = (name, extra, sub) =>
    BPARAM(name, 'text.content', LV, D, { format: extra }, sub, undefined);
  BX('invalid-param-decimals-7', { decimals: 7 }, '/format/decimals');
  BX('invalid-param-decimals-negative', { decimals: -1 }, '/format/decimals');
  BX('invalid-param-decimals-fraction', { decimals: 1.5 }, '/format/decimals');
  BX('invalid-param-prefix-17', { prefix: 'p'.repeat(17) }, '/format/prefix');
  BX('invalid-param-suffix-17', { suffix: 's'.repeat(17) }, '/format/suffix');
  BX('invalid-param-prefix-not-string', { prefix: 1 }, '/format/prefix');
  BX('invalid-param-unit-from-tag-not-boolean', { unitFromTag: 'yes' }, '/format/unitFromTag');
  BX('invalid-param-format-unknown-key', { color: 'red' }, '/format/color');
  BPARAM('invalid-param-format-not-object', 'text.content', LV, D, { format: 'x' }, '/format');
  // tham số không thuộc đích
  BPARAM(
    'invalid-param-period-on-fill',
    'style.fill',
    FAULT,
    BOOLMAP('#f00', '#000'),
    { period: 1000 },
    '/period',
  );
  BPARAM(
    'invalid-param-pivot-on-fill',
    'style.fill',
    FAULT,
    BOOLMAP('#f00', '#000'),
    { pivot: [0.5, 0.5] },
    '/pivot',
  );
  BPARAM(
    'invalid-param-direction-on-rotate',
    'transform.rotate',
    LV,
    D,
    { direction: 'up' },
    '/direction',
  );
  BPARAM(
    'invalid-param-speed-on-blink',
    'effect.blink',
    FAULT,
    D,
    { speed: 10 },
    '/speed',
    undefined,
  );
  BPARAM(
    'invalid-param-format-on-fill',
    'style.fill',
    FAULT,
    BOOLMAP('#f00', '#000'),
    { format: { decimals: 1 } },
    '/format',
  );
  BPARAM('invalid-param-axis-on-rotate', 'transform.rotate', LV, D, { axis: 'x' }, '/axis');
  BPARAM(
    'invalid-param-animation-on-scale',
    'transform.scale',
    LV,
    D,
    { animation: 'spin' },
    '/animation',
  );
  BPARAM('invalid-param-dash-on-blink', 'effect.blink', FAULT, D, { dash: '4 4' }, '/dash');
  BPARAM(
    'invalid-param-byvaluesign-on-text',
    'text.content',
    LV,
    D,
    { byValueSign: true },
    '/byValueSign',
  );
  BPARAM(
    'invalid-param-minopacity-on-flow',
    'effect.flow',
    RUN,
    D,
    { minOpacity: 0.2 },
    '/minOpacity',
  );

  // ================= Không hợp lệ: rangeMap =================
  const BE = (name, ranges, sub, tag = LV) =>
    badB(name, b('b1', 'text.content', tag, RM(ranges)), ['E_RANGE'], [atb('E_RANGE', bp(sub))]);
  BE(
    'invalid-range-overlap',
    [
      { from: 0, to: 10, value: 'a' },
      { from: 5, to: 15, value: 'b' },
    ],
    '/transform/ranges/1',
  );
  BE(
    'invalid-range-overlap-nested',
    [
      { from: 0, to: 100, value: 'a' },
      { from: 10, to: 20, value: 'b' },
    ],
    '/transform/ranges/1',
  );
  BE(
    'invalid-range-overlap-open-ends',
    [
      { to: 10, value: 'a' },
      { to: 5, value: 'b' },
    ],
    '/transform/ranges/1',
  );
  BE(
    'invalid-range-overlap-unordered',
    [
      { from: 5, to: 15, value: 'b' },
      { from: 0, to: 10, value: 'a' },
    ],
    '/transform/ranges/1',
  );
  BE('invalid-range-from-equals-to', [{ from: 5, to: 5, value: 'a' }], '/transform/ranges/0');
  BE(
    'invalid-range-from-greater-than-to',
    [{ from: 10, to: 5, value: 'a' }],
    '/transform/ranges/0',
  );
  BE('invalid-range-no-from-no-to', [{ value: 'a' }], '/transform/ranges/0');
  BE('invalid-range-empty-list', [], '/transform/ranges');
  BE('invalid-range-65-ranges', rangesN(65), '/transform/ranges');
  badB(
    'invalid-range-default-ok-but-overlap',
    b(
      'b1',
      'style.fill',
      LV,
      RM(
        [
          { to: 50, value: '#f00' },
          { from: 49, value: '#0f0' },
        ],
        '#999',
      ),
    ),
    ['E_RANGE'],
    [atb('E_RANGE', bp('/transform/ranges/1'))],
  );

  // ================= Không hợp lệ: kiểu Tag, Tag, bảng =================
  const TM = (name, target, tag, transform, extra, sub) =>
    badB(
      name,
      b('b1', target, tag, transform, extra),
      ['E_TYPE_MISMATCH'],
      [atb('E_TYPE_MISMATCH', bp(sub))],
    );
  TM(
    'invalid-type-string-tag-to-opacity',
    'style.opacity',
    NAME,
    DM([{ equals: 'a', value: 1 }]),
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-string-tag-to-rotate',
    'transform.rotate',
    NAME,
    DM([{ equals: 'a', value: 1 }]),
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-string-tag-to-flow',
    'effect.flow',
    NAME,
    DM([{ equals: 'a', value: 1 }]),
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-string-tag-to-blink',
    'effect.blink',
    NAME,
    DM([{ equals: 'a', value: true }]),
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-string-tag-to-level',
    'geometry.levelPercent',
    NAME,
    D,
    undefined,
    '/source/tagId',
  );
  TM('invalid-type-bool-direct-fill', 'style.fill', FAULT, D, undefined, '/source/tagId');
  TM('invalid-type-number-direct-stroke', 'style.stroke', LV, D, undefined, '/source/tagId');
  TM(
    'invalid-type-number-direct-visibility',
    'style.visibility',
    LV,
    D,
    undefined,
    '/source/tagId',
  );
  TM('invalid-type-bool-direct-opacity', 'style.opacity', FAULT, D, undefined, '/source/tagId');
  TM('invalid-type-bool-direct-rotate', 'transform.rotate', FAULT, D, undefined, '/source/tagId');
  TM('invalid-type-string-direct-blink', 'effect.blink', NAME, D, undefined, '/source/tagId');
  TM(
    'invalid-type-bool-direct-level',
    'geometry.levelPercent',
    FAULT,
    D,
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-bool-direct-clip-level',
    'geometry.clipLevel',
    FAULT,
    D,
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-bool-direct-translate',
    'transform.translateX',
    FAULT,
    D,
    undefined,
    '/source/tagId',
  );
  TM(
    'invalid-type-rangemap-on-bool-tag',
    'style.fill',
    FAULT,
    RM([{ from: 0, value: '#f00' }]),
    undefined,
    '/transform',
  );
  TM(
    'invalid-type-rangemap-on-string-tag',
    'text.content',
    NAME,
    RM([{ from: 0, value: 'x' }]),
    undefined,
    '/transform',
  );
  TM('invalid-type-linear-on-bool-tag', 'style.opacity', FAULT, LIN, undefined, '/transform');
  TM(
    'invalid-type-discrete-equals-wrong-type',
    'text.content',
    FAULT,
    DM([{ equals: 1, value: 'x' }]),
    undefined,
    '/transform/cases',
  );
  TM(
    'invalid-type-valuetable-on-string-tag',
    'text.content',
    NAME,
    { kind: 'valueTable', table: 'TrangThaiBom', output: 'text' },
    undefined,
    '/transform',
  );
  TM(
    'invalid-type-valuetable-output-color-on-text',
    'text.content',
    STATE,
    { kind: 'valueTable', output: 'color' },
    undefined,
    '/transform/output',
  );
  TM(
    'invalid-type-valuetable-output-text-on-fill',
    'style.fill',
    STATE,
    { kind: 'valueTable', output: 'text' },
    undefined,
    '/transform/output',
  );
  badB(
    'invalid-ref-tag-unknown',
    b('b1', 'text.content', 'NO.SUCH', D),
    ['E_REF_TAG'],
    [atb('E_REF_TAG', bp('/source/tagId'))],
  );
  badB(
    'invalid-ref-table-unknown',
    b('b1', 'text.content', STATE, { kind: 'valueTable', table: 'Khong', output: 'text' }),
    ['E_REF_TABLE'],
    [atb('E_REF_TABLE', bp('/transform/table'))],
  );
  badB(
    'invalid-ref-table-none',
    b('b1', 'text.content', LV, { kind: 'valueTable', output: 'text' }),
    ['E_REF_TABLE'],
    [atb('E_REF_TABLE', bp('/transform/table'))],
  );
  badB(
    'invalid-scale-range-equal',
    b('b1', 'style.opacity', LV, LS(5, 5, 0, 1)),
    ['E_SCALE_RANGE'],
    [atb('E_SCALE_RANGE', bp('/transform'))],
  );

  // ================= Không hợp lệ: trùng nhóm đích, uid =================
  const DUP = (name, bindings) =>
    bad(
      name,
      (f) => setB(f, ...bindings),
      ['E_DUP_BINDING'],
      undefined,
      iss(atb('E_DUP_BINDING', '/elements/0/bindings/1/target')),
    );
  DUP('invalid-dup-group-fill-twice', [
    b('b1', 'style.fill', FAULT, BOOLMAP('#f00', '#000')),
    b('b2', 'style.fill', FAULT, BOOLMAP('#0f0', '#111')),
  ]);
  DUP('invalid-dup-group-stroke-twice', [
    b('b1', 'style.stroke', FAULT, BOOLMAP('#f00', '#000')),
    b('b2', 'style.stroke', LV, RM(COLOR_RANGES)),
  ]);
  DUP('invalid-dup-group-rotate-and-spin', [
    b('b1', 'transform.rotate', LV, D),
    b('b2', 'transform.rotate', RUN, D, { animation: 'spin' }),
  ]);
  DUP('invalid-dup-group-spin-twice', [
    b('b1', 'transform.rotate', RUN, D, { animation: 'spin' }),
    b('b2', 'transform.rotate', LV, D, { animation: 'spin', reverse: true }),
  ]);
  DUP('invalid-dup-group-level-and-clip', [
    b('b1', 'geometry.levelPercent', LV, D),
    b('b2', 'geometry.clipLevel', LV, D),
  ]);
  DUP('invalid-dup-group-blink-twice', [
    b('b1', 'effect.blink', FAULT, D),
    b('b2', 'effect.blink', HIGH, D),
  ]);
  DUP('invalid-dup-group-flow-twice', [
    b('b1', 'effect.flow', RUN, D),
    b('b2', 'effect.flow', LV, LIN),
  ]);
  DUP('invalid-dup-group-text-twice', [
    b('b1', 'text.content', LV, D),
    b('b2', 'text.content', NAME, D),
  ]);
  DUP('invalid-dup-group-translate-x-twice', [
    b('b1', 'transform.translateX', LV, D),
    b('b2', 'transform.translateX', LV, LIN),
  ]);
  DUP('invalid-dup-group-scale-twice', [
    b('b1', 'transform.scale', LV, D),
    b('b2', 'transform.scale', LV, LIN),
  ]);
  DUP('invalid-dup-group-opacity-twice', [
    b('b1', 'style.opacity', LV, D),
    b('b2', 'style.opacity', LV, LIN),
  ]);
  DUP('invalid-dup-group-visibility-twice', [
    b('b1', 'style.visibility', FAULT, D),
    b('b2', 'style.visibility', HIGH, D),
  ]);
  bad(
    'invalid-dup-binding-id',
    (f) => setB(f, b('same', 'text.content', LV, D), b('same', 'style.fill', LV, RM(COLOR_RANGES))),
    ['E_DUP_BINDING'],
    undefined,
    iss(atb('E_DUP_BINDING', '/elements/0/bindings/1/id')),
  );
  bad(
    'invalid-dup-binding-id-across-elements',
    (f) => {
      f[MB].elements = [
        { elementUid: 'el_aaa', bindings: [b('same', 'text.content', LV, D)] },
        { elementUid: 'el_bbb', bindings: [b('same', 'text.content', LV, D)] },
      ];
    },
    ['E_DUP_BINDING'],
    undefined,
    iss(atb('E_DUP_BINDING', '/elements/1/bindings/0/id')),
  );
  bad(
    'invalid-dup-uid-in-bindings',
    (f) => {
      f[MB].elements = [
        { elementUid: 'el_aaa', bindings: [b('b1', 'text.content', LV, D)] },
        { elementUid: 'el_aaa', events: { click: { action: 'closePopup' } } },
      ];
    },
    ['E_DUP_UID'],
    undefined,
    iss(atb('E_DUP_UID', '/elements/1/elementUid')),
  );
  bad(
    'invalid-ref-uid-binding',
    (f) =>
      (f[MB].elements = [{ elementUid: 'el_zzz', bindings: [b('b1', 'text.content', LV, D)] }]),
    ['E_REF_UID'],
    undefined,
    iss(atb('E_REF_UID', '/elements/0/elementUid')),
  );
  bad(
    'invalid-ref-uid-event',
    (f) =>
      (f[MB].elements = [{ elementUid: 'el_zzz', events: { click: { action: 'closePopup' } } }]),
    ['E_REF_UID'],
    undefined,
    iss(atb('E_REF_UID', '/elements/0/elementUid')),
  );

  // ================= Không hợp lệ: sự kiện =================
  const EA = (name, click, sub = '') =>
    badE(name, click, ['E_EVENT_ACTION'], [atb('E_EVENT_ACTION', ep(sub))]);
  bad(
    'invalid-event-key-not-click',
    (f) =>
      (f[MB].elements = [{ elementUid: 'el_aaa', events: { dblclick: { action: 'closePopup' } } }]),
    ['E_EVENT_ACTION'],
    undefined,
    iss(atb('E_EVENT_ACTION', '/elements/0/events/dblclick')),
  );
  bad(
    'invalid-event-two-keys',
    (f) =>
      (f[MB].elements = [
        {
          elementUid: 'el_aaa',
          events: { click: { action: 'closePopup' }, hover: { action: 'closePopup' } },
        },
      ]),
    ['E_EVENT_ACTION'],
    undefined,
    iss(atb('E_EVENT_ACTION', '/elements/0/events/hover')),
  );
  bad(
    'invalid-event-empty-events',
    (f) => (f[MB].elements = [{ elementUid: 'el_aaa', events: {} }]),
    ['E_EVENT_ACTION'],
    undefined,
    iss(atb('E_EVENT_ACTION', '/elements/0/events')),
  );
  EA('invalid-event-click-not-object', 'toggle');
  EA('invalid-event-missing-action', { tag: RUN });
  EA('invalid-event-action-unknown', { action: 'drag', tag: RUN }, '/action');
  EA('invalid-event-action-not-string', { action: 1 }, '/action');
  EA('invalid-event-write-missing-value', { action: 'write', tag: RUN });
  EA('invalid-event-write-missing-tag', { action: 'write', value: true });
  EA('invalid-event-toggle-missing-tag', { action: 'toggle' });
  EA('invalid-event-pulse-missing-duration', { action: 'pulse', tag: RUN, value: true });
  EA('invalid-event-pulse-missing-value', { action: 'pulse', tag: RUN, durationMs: 500 });
  EA('invalid-event-navigate-missing-screen', { action: 'navigate' });
  EA('invalid-event-popup-missing-screen', { action: 'popup' });
  EA('invalid-event-navigate-extra-tag', { action: 'navigate', screen: 'main', tag: RUN }, '/tag');
  EA('invalid-event-close-popup-extra-screen', { action: 'closePopup', screen: 'pump' }, '/screen');
  EA(
    'invalid-event-close-popup-extra-confirm',
    { action: 'closePopup', confirm: 'always' },
    '/confirm',
  );
  EA(
    'invalid-event-popup-extra-minrole',
    { action: 'popup', screen: 'pump', minRole: 'operator' },
    '/minRole',
  );
  EA('invalid-event-toggle-extra-value', { action: 'toggle', tag: RUN, value: true }, '/value');
  EA(
    'invalid-event-toggle-extra-duration',
    { action: 'toggle', tag: RUN, durationMs: 100 },
    '/durationMs',
  );
  EA(
    'invalid-event-write-extra-duration',
    { action: 'write', tag: RUN, value: true, durationMs: 100 },
    '/durationMs',
  );
  EA('invalid-event-unknown-field', { action: 'toggle', tag: RUN, x: 1 }, '/x');
  for (const d of [99, 10001, 0, -5])
    EA(
      `invalid-event-pulse-duration-${String(d).replace('-', 'neg')}`,
      { action: 'pulse', tag: RUN, value: true, durationMs: d },
      '/durationMs',
    );
  EA(
    'invalid-event-pulse-duration-fraction',
    { action: 'pulse', tag: RUN, value: true, durationMs: 100.5 },
    '/durationMs',
  );
  EA(
    'invalid-event-pulse-value-not-boolean',
    { action: 'pulse', tag: RUN, value: 1, durationMs: 500 },
    '/value',
  );
  EA('invalid-event-write-value-object', { action: 'write', tag: RUN, value: { a: 1 } }, '/value');
  EA('invalid-event-write-value-null', { action: 'write', tag: RUN, value: null }, '/value');
  EA('invalid-event-label-81', { action: 'closePopup', label: 'L'.repeat(81) }, '/label');
  EA('invalid-event-label-not-string', { action: 'closePopup', label: 5 }, '/label');
  EA('invalid-event-tag-not-string', { action: 'toggle', tag: 5 }, '/tag');
  EA('invalid-event-screen-not-string', { action: 'navigate', screen: 5 }, '/screen');
  const ET = (name, click, sub, mutate) =>
    badE(name, click, ['E_EVENT_TAG'], [atb('E_EVENT_TAG', ep(sub))], undefined, mutate);
  ET('invalid-event-tag-unknown', { action: 'toggle', tag: 'NO.SUCH' }, '/tag');
  ET('invalid-event-tag-read-only', { action: 'toggle', tag: FAULT }, '/tag');
  ET('invalid-event-write-read-only-float', { action: 'write', tag: LV, value: 1 }, '/tag');
  ET('invalid-event-tag-calculated', { action: 'toggle', tag: HIGH }, '/tag');
  ET('invalid-event-tag-simulation-not-manual', { action: 'write', tag: WAVE, value: 1 }, '/tag');
  ET('invalid-event-toggle-not-bool', { action: 'toggle', tag: SP }, '/tag');
  ET(
    'invalid-event-pulse-not-bool',
    { action: 'pulse', tag: SP, value: true, durationMs: 500 },
    '/tag',
  );
  ET('invalid-event-write-string-to-bool', { action: 'write', tag: RUN, value: 'true' }, '/value');
  ET('invalid-event-write-number-to-bool', { action: 'write', tag: RUN, value: 1 }, '/value');
  ET('invalid-event-write-bool-to-float', { action: 'write', tag: SP, value: true }, '/value');
  ET('invalid-event-write-above-limit', { action: 'write', tag: SP, value: 90.5 }, '/value');
  ET('invalid-event-write-below-limit', { action: 'write', tag: SP, value: -1 }, '/value');
  ET(
    'invalid-event-write-above-limit-manual-sim',
    { action: 'write', tag: SET, value: 101 },
    '/value',
  );
  ET('invalid-event-write-fraction-to-int', { action: 'write', tag: SET, value: 1.5 }, '/value');
  ET(
    'invalid-event-write-string-too-long',
    { action: 'write', tag: NOTE, value: 'abcdefghi' },
    '/value',
  );
  ET('invalid-event-write-number-to-string', { action: 'write', tag: NOTE, value: 1 }, '/value');
  const EG = (name, click, errs, sub = '') => badE(name, click, errs, [atb(errs[0], ep(sub))]);
  EG(
    'invalid-event-navigate-unknown-screen',
    { action: 'navigate', screen: 'nowhere' },
    ['E_EVENT_TARGET'],
    '/screen',
  );
  EG(
    'invalid-event-navigate-to-popup',
    { action: 'navigate', screen: 'pump' },
    ['E_EVENT_TARGET'],
    '/screen',
  );
  EG(
    'invalid-event-popup-to-screen',
    { action: 'popup', screen: 'main' },
    ['E_EVENT_TARGET'],
    '/screen',
  );
  EG(
    'invalid-event-popup-unknown-screen',
    { action: 'popup', screen: 'nowhere' },
    ['E_EVENT_TARGET'],
    '/screen',
  );
  EG(
    'invalid-event-confirm-none-float',
    { action: 'write', tag: SP, value: 10, confirm: 'none' },
    ['E_EVENT_CONFIRM'],
    '/confirm',
  );
  EG(
    'invalid-event-confirm-none-int-manual-sim',
    { action: 'write', tag: SET, value: 1, confirm: 'none' },
    ['E_EVENT_CONFIRM'],
    '/confirm',
  );
  EG(
    'invalid-event-confirm-none-string',
    { action: 'write', tag: NOTE, value: 'a', confirm: 'none' },
    ['E_EVENT_CONFIRM'],
    '/confirm',
  );
  EG(
    'invalid-event-confirm-unknown',
    { action: 'toggle', tag: RUN, confirm: 'maybe' },
    ['E_EVENT_CONFIRM'],
    '/confirm',
  );
  EG(
    'invalid-event-confirm-not-string',
    { action: 'toggle', tag: RUN, confirm: true },
    ['E_EVENT_CONFIRM'],
    '/confirm',
  );
  EG(
    'invalid-event-minrole-viewer',
    { action: 'toggle', tag: RUN, minRole: 'viewer' },
    ['E_EVENT_MINROLE'],
    '/minRole',
  );
  EG(
    'invalid-event-minrole-unknown',
    { action: 'toggle', tag: RUN, minRole: 'root' },
    ['E_EVENT_MINROLE'],
    '/minRole',
  );
  EG(
    'invalid-event-minrole-not-string',
    { action: 'toggle', tag: RUN, minRole: 1 },
    ['E_EVENT_MINROLE'],
    '/minRole',
  );
  EG(
    'invalid-event-minrole-on-pulse',
    { action: 'pulse', tag: RUN, value: true, durationMs: 500, minRole: 'guest' },
    ['E_EVENT_MINROLE'],
    '/minRole',
  );
  // cảnh báo kèm vị trí
  ok(
    'warn-event-confirm-none-bool',
    (f) => setE(f, { action: 'toggle', tag: RUN, confirm: 'none' }),
    ['W_EVENT_CONFIRM_NONE'],
    iss(atb('W_EVENT_CONFIRM_NONE', ep('/confirm'))),
  );
  ok(
    'warn-event-pulse-readback',
    (f) => setE(f, { action: 'pulse', tag: CMD2, value: true, durationMs: 500 }),
    ['W_EVENT_PULSE_READBACK'],
    iss(atb('W_EVENT_PULSE_READBACK', ep())),
  );
  ok('valid-event-pulse-no-readback', (f) =>
    setE(f, { action: 'pulse', tag: RUN, value: true, durationMs: 500 }),
  );

  // ================= Phiên bản, tệp, đường dẫn =================
  bad(
    'invalid-min-runtime-0_6_0',
    (f) => (f[PJ].minRuntimeVersion = '0.6.0'),
    ['E_MIN_RUNTIME'],
    undefined,
    iss(at('E_MIN_RUNTIME', '/minRuntimeVersion', PJ)),
  );
  bad(
    'invalid-min-runtime-0_5_0',
    (f) => (f[PJ].minRuntimeVersion = '0.5.0'),
    ['E_MIN_RUNTIME'],
    undefined,
    iss(at('E_MIN_RUNTIME', '/minRuntimeVersion', PJ)),
  );
  bad(
    'invalid-runtime-too-old-0_10_0',
    (f) => (f[PJ].minRuntimeVersion = '1.10.0'), // runtime 1.0.0 (011); '1.10' < '1.9' nếu so theo chữ: bẫy so sánh semver
    ['E_RUNTIME_TOO_OLD'],
    undefined,
    iss(at('E_RUNTIME_TOO_OLD', '/minRuntimeVersion', PJ)),
  );
  ok('valid-min-runtime-0_7_0', (f) => (f[PJ].minRuntimeVersion = '0.7.0'));
  bad(
    'invalid-schema-version-mixed-binding',
    (f) => (f[MB].schemaVersion = '0.3.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(atb('E_SCHEMA_VERSION', '/schemaVersion')),
  );
  bad(
    'invalid-schema-version-mixed-screen',
    (f) => (f[MS].schemaVersion = '0.3.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', MS)),
  );
  bad(
    'invalid-schema-version-mixed-tags',
    (f) => (f[TAGS].schemaVersion = '0.3.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', TAGS)),
  );
  ok('valid-schema-version-0_4_7', (f) => {
    for (const v of Object.values(f))
      if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
        v.schemaVersion = '0.4.7';
  });
  bad(
    'invalid-path-svg-dotdot',
    (f) => (f[MS].items[0].svgFile = '../x.svg'),
    ['E_PATH'],
    undefined,
    iss(at('E_PATH', '/items/0/svgFile')),
  );
  bad(
    'invalid-path-binding-absolute',
    (f) => (f[MS].items[0].bindingFile = '/etc/x.json'),
    ['E_PATH'],
    undefined,
    iss(at('E_PATH', '/items/0/bindingFile')),
  );
  bad('invalid-file-missing-svg', (f) => delete f[MSVG], ['E_FILE_MISSING']);
  bad('invalid-file-missing-binding', (f) => delete f[MB], ['E_FILE_MISSING']);
  bad(
    'invalid-binding-screen-id',
    (f) => (f[MB].screenId = 'pump'),
    ['E_SCREEN_ID'],
    undefined,
    iss(atb('E_SCREEN_ID', '/screenId')),
  );
  bad('invalid-binding-item-id', (f) => (f[MB].itemId = 'svg9'), ['E_SCHEMA'], undefined);
  bad(
    'invalid-shared-binding-file',
    (f) => {
      const it = f[MS].items[0];
      f[MS].items.push({ ...JSON.parse(JSON.stringify(it)), id: 'svg2', x: 0, y: 420 });
    },
    ['E_SCHEMA'],
    undefined,
    iss(at('E_SCHEMA', '/items/10/bindingFile')), // item mới thêm sau 10 item của base
  );
  ok('valid-two-items-shared-svg', (f) => {
    const it = f[MS].items[0];
    f['screens/main.svg2.bindings.json'] = {
      schemaVersion: V,
      screenId: 'main',
      itemId: 'svg2',
      elements: [
        { elementUid: 'el_bbb', bindings: [b('x1', 'style.fill', FAULT, BOOLMAP('#f00', '#000'))] },
      ],
    };
    f[MS].items.push({
      ...JSON.parse(JSON.stringify(it)),
      id: 'svg2',
      y: 420,
      bindingFile: 'screens/main.svg2.bindings.json',
    });
  });
  ok('valid-svg-under-graphics-symbols', (f) => {
    f['graphics/symbols/pump-centrifugal.svg'] = f[MSVG];
    f[MS].items[0].svgFile = 'graphics/symbols/pump-centrifugal.svg';
    delete f[MSVG];
  });
  return C;
}

/** Ca lớn (chỉ sinh vào out/). */
export function large04() {
  const L = [];
  const compact = (f) => {
    for (const k of Object.keys(f))
      if (k.endsWith('.json') && typeof f[k] === 'object') f[k] = JSON.stringify(f[k]) + '\n';
  };
  const warnAnim = ['W_ANIM_MANY'];
  const svgItem = (id, bindingFile, uids, x = 0, y = 0, extra = {}) => ({
    id,
    name: id,
    type: 'svg',
    x,
    y,
    width: 20,
    height: 20,
    svgFile: MSVG,
    bindingFile,
    viewBox: [0, 0, 100, 100],
    fit: 'contain',
    elements: uids.map((elementUid) => ({ elementUid })),
    ...extra,
  });
  const bindFile = (itemId, elements) => ({ schemaVersion: V, screenId: 'main', itemId, elements });

  /** n item svg, mỗi item một phần tử `el_aaa` có một binding mức. */
  const manyItems = (n) => (f) => {
    f[MS].items = [];
    delete f[MB];
    for (let i = 0; i < n; i++) {
      const id = `svg${pad(i + 1, 3)}`;
      const file = `screens/main.${id}.bindings.json`;
      f[MS].items.push(svgItem(id, file, ['el_aaa'], (i % 13) * 90, Math.floor(i / 13) * 90));
      f[file] = bindFile(id, [
        { elementUid: 'el_aaa', bindings: [b('b1', 'geometry.levelPercent', LV, D)] },
      ]);
    }
    compact(f);
  };
  /** n hoạt ảnh vô hạn (spin) chia cho `items` item svg (item đầu có thể ẩn). */
  const anims =
    (n, items = 1, hidden = false) =>
    (f) => {
      f[MS].items = [];
      delete f[MB];
      const per = Math.ceil(n / items);
      let made = 0;
      for (let k = 0; k < items; k++) {
        const id = `svg${pad(k + 1, 2)}`;
        const file = `screens/main.${id}.bindings.json`;
        const uids = [];
        const els = [];
        for (let i = 0; i < per && made < n; i++, made++) {
          const uid = `el_a${pad(made + 1)}`;
          uids.push(uid);
          els.push({
            elementUid: uid,
            bindings: [b(`b${pad(made + 1)}`, 'transform.rotate', LV, D, { animation: 'spin' })],
          });
        }
        f[MS].items.push(svgItem(id, file, uids, k * 30, 0, hidden ? { hidden: true } : {}));
        f[file] = bindFile(id, els);
      }
      compact(f);
    };
  /** Hoạt ảnh hỗn hợp: spin, blink (kèm text cùng Tag), flow; tổng n. */
  const mixed = (n) => (f) => {
    f[MS].items = [];
    delete f[MB];
    const els = [];
    const uids = [];
    for (let i = 0; i < n; i++) {
      const uid = `el_m${pad(i + 1)}`;
      uids.push(uid);
      const kind = i % 3;
      const bindings =
        kind === 0
          ? [b(`b${pad(i + 1)}`, 'transform.rotate', RUN, D, { animation: 'spin' })]
          : kind === 1
            ? [
                b(`b${pad(i + 1)}`, 'effect.blink', FAULT, D),
                b(`t${pad(i + 1)}`, 'text.content', FAULT, D),
              ]
            : [b(`b${pad(i + 1)}`, 'effect.flow', RUN, D)];
      els.push({ elementUid: uid, bindings });
    }
    f[MS].items.push(svgItem('svg01', MB, uids));
    f[MB] = bindFile('svg01', els);
    compact(f);
  };
  L.push(['v04-large-valid-svg-items-64', manyItems(64), [], []]);
  L.push([
    'v04-large-invalid-svg-items-65',
    manyItems(65),
    ['E_LIMIT'],
    undefined,
    { issues: [at('E_LIMIT', '/items')] },
  ]);
  L.push(['v04-large-valid-anim-64', anims(64), [], []]);
  L.push([
    'v04-large-warn-anim-65',
    anims(65),
    [],
    warnAnim,
    { issues: [at('W_ANIM_MANY', '/items')] },
  ]);
  L.push(['v04-large-warn-anim-256', anims(256), [], warnAnim]);
  L.push([
    'v04-large-invalid-anim-257',
    anims(257),
    ['E_LIMIT'],
    warnAnim,
    { issues: [at('E_LIMIT', '/items')] },
  ]);
  L.push(['v04-large-warn-anim-256-two-items', anims(256, 2), [], warnAnim]);
  L.push([
    'v04-large-invalid-anim-257-two-items',
    anims(257, 2),
    ['E_LIMIT'],
    warnAnim,
    { issues: [at('E_LIMIT', '/items')] },
  ]);
  L.push(['v04-large-valid-anim-hidden-item-excluded', anims(300, 1, true), [], []]);
  L.push(['v04-large-warn-anim-mixed-65', mixed(65 * 1), [], warnAnim]);
  L.push(['v04-large-valid-anim-mixed-64', mixed(64), [], []]);
  // Tag của màn hình tính cả Tag của sự kiện: 999 Tag binding + 1 Tag sự kiện = 1.000; 1.000 + 1 = 1.001
  const screenTags = (n) => (f) => {
    f[MS].items = [];
    delete f[MB];
    const els = [];
    const uids = [];
    for (let i = 0; i < n; i++) {
      const id = `X.T${pad(i + 1)}`;
      f[TAGS].tags.push({ id, kind: 'internal', type: 'FLOAT32', initial: 0 });
      const uid = `el_t${pad(i + 1)}`;
      uids.push(uid);
      els.push({ elementUid: uid, bindings: [b(`b${pad(i + 1)}`, 'text.content', id, D)] });
    }
    uids.push('el_evt');
    els.push({ elementUid: 'el_evt', events: { click: { action: 'toggle', tag: RUN } } });
    f[MS].items.push(svgItem('svg01', MB, uids));
    f[MB] = bindFile('svg01', els);
    f[PS].items = [];
    compact(f);
  };
  L.push([
    'v04-large-warn-screen-tags-1000-with-event',
    screenTags(999),
    [],
    ['W_SCREEN_TAGS_MANY', 'W_SCREEN_EMPTY'],
  ]);
  L.push([
    'v04-large-invalid-screen-tags-1001-with-event',
    screenTags(1000),
    ['E_SCREEN_TAGS'],
    ['W_SCREEN_TAGS_MANY', 'W_SCREEN_EMPTY'],
    { issues: [at('E_SCREEN_TAGS', '/items')] },
  ]);
  return L;
}
