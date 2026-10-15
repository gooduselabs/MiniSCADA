// Ca `v03-*` của bộ vector project (feature 007, contracts/project-format-0.3.md §7, §12; widget-catalog.md).
// Được generate.mjs nạp: `cases03()` trả các ca nhỏ (commit), `large03()` trả các ca lớn (chỉ sinh vào out/ lúc
// chạy test: `node tests/project-vectors/generate.mjs --out03`).
//
// Mỗi ca: [tên, hàm sửa base, mã lỗi (tập), mã cảnh báo (tập, tùy chọn), thêm { issues }].
// `issues`: [{ code, file, path }] các lỗi/cảnh báo phải xuất hiện đúng vị trí (chứa, không cần liệt kê hết);
// lỗi E_SCHEMA, E_JSON và E_FILE_MISSING không ghi `path` vì hai bộ kiểm tra (cfworker, valijson) đặt
// đường dẫn khác nhau cho từng lỗi cấu trúc. Mọi ca hợp lệ ghi `warnings` rõ ràng (kể cả []).
// Quy ước đường dẫn (JSON Pointer tới khóa sai) ghi ở specs/007-screens-widgets/contracts/project-format-0.3.md §7.3.
import { base02 } from './v02.mjs';

const V = '0.3.0';
const MS = 'screens/main.screen.json';
const PS = 'screens/pump.screen.json';
const MB = 'screens/main.bindings.json';
const MSVG = 'screens/main.svg';
const PJ = 'project.json';
const TAGS = 'tags.json';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Item `widget` tối thiểu: cỡ 300 x 200 ở (10, 10), đủ lớn hơn `minSize` của mọi loại. */
export const W = (id, widget, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  x: 10,
  y: 10,
  width: 300,
  height: 200,
  ...extra,
});

/** Project 0.3 hợp lệ: 2 màn hình (main có item svg + widget, pump là popup), Tag và file khác như base02. */
export function base03() {
  const f = base02();
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined) v.schemaVersion = V;
  delete f['screens/main.screen.json'];
  f[PJ] = {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: 'vector03',
    projectName: 'Vector 0.3',
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.6.0',
    entryScreen: 'main',
    screens: ['main', 'pump'],
    tagFile: TAGS,
    connectionFile: 'connections.json',
    valueTables: ['TrangThaiBom'],
    watchTables: ['van-hanh'],
    navigation: { position: 'left', items: [{ label: 'Main', screen: 'main', icon: 'home' }] },
    maxClients: 10,
  };
  f[MS] = {
    schemaVersion: V,
    id: 'main',
    name: 'Main',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    fitMode: 'contain',
    items: [
      {
        id: 'svg1',
        name: 'Do hoa',
        type: 'svg',
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        svgFile: MSVG,
        bindingFile: MB,
        viewBox: [0, 0, 100, 100],
        fit: 'contain',
        elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }, { elementUid: 'el_ccc' }],
      },
      W('panel_1', 'panel', { x: 420, y: 20, width: 440, height: 340, props: { title: 'Bon 1' } }),
      W('card_level', 'card', {
        x: 440,
        y: 60,
        width: 220,
        height: 110,
        props: { label: 'Muc nuoc' },
        tags: { value: 'TANK01.LEVEL' },
      }),
      W('lamp_fault', 'lamp', {
        x: 680,
        y: 60,
        width: 140,
        height: 40,
        tags: { state: 'PUMP01.FAULT' },
      }),
      W('gauge_level', 'gauge', {
        x: 440,
        y: 190,
        width: 240,
        height: 160,
        props: { min: 0, max: 100 },
        tags: { value: 'TANK01.LEVEL' },
      }),
      W('sp_level', 'setpoint', {
        x: 700,
        y: 190,
        width: 220,
        height: 72,
        props: { min: 0, max: 90 },
        tags: { target: 'TANK01.SP' },
        security: { minRole: 'engineer' },
      }),
      W('btn_run', 'button', {
        x: 700,
        y: 280,
        width: 160,
        height: 48,
        props: { label: 'Bat bom' },
        tags: { target: 'PUMP01.RUN_CMD' },
        events: { click: { action: 'toggle' } },
      }),
      W('btn_pump', 'button', {
        x: 880,
        y: 280,
        width: 160,
        height: 48,
        props: { label: 'Chi tiet', variant: 'neutral' },
        events: { click: { action: 'popup', screen: 'pump' } },
      }),
      W('trend', 'line', {
        x: 20,
        y: 420,
        width: 600,
        height: 280,
        tags: { series: ['TANK01.LEVEL', 'TANK01.SP'] },
      }),
      W('tbl', 'tag-table', {
        x: 640,
        y: 420,
        width: 420,
        height: 280,
        tags: { rows: ['TANK01.LEVEL', 'PUMP01.STATE', 'PUMP01.NAME'] },
      }),
    ],
  };
  f[PS] = {
    schemaVersion: V,
    id: 'pump',
    name: 'Bom 1',
    kind: 'popup',
    size: { width: 480, height: 320 },
    items: [
      W('panel_p', 'panel', { x: 0, y: 0, width: 480, height: 320, props: { title: 'Bom 1' } }),
      W('name_p', 'label', {
        x: 20,
        y: 50,
        width: 200,
        height: 40,
        tags: { value: 'PUMP01.NAME' },
      }),
      W('sw_run', 'switch', {
        x: 20,
        y: 110,
        width: 160,
        height: 48,
        tags: { target: 'PUMP01.RUN_CMD' },
      }),
      W('btn_close', 'button', {
        x: 300,
        y: 250,
        width: 160,
        height: 48,
        props: { label: 'Dong', variant: 'neutral' },
        events: { click: { action: 'closePopup' } },
      }),
    ],
  };
  f[MB].itemId = 'svg1';
  extras(f);
  return f;
}

// ---- Trợ giúp sửa base ----
export const items = (f) => f[MS].items;
const only = (f, ...its) => {
  f[MS].items = its;
};
const tagsOf = (f) => f[TAGS].tags;
const addTag = (f, t) => tagsOf(f).push(t);
const at = (code, path, file = MS) => ({ code, file, path });
const pad = (i, w = 4) => String(i).padStart(w, '0');
/** Tag nội bộ phụ trợ (BOOL đọc lại, STRING RW, UINT16 RW, INT16 RW không bảng) có sẵn trong base03. */
const extras = (f) => {
  addTag(f, {
    id: 'PUMP02.CMD',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'plc1', address: 'C11' },
  });
  addTag(f, {
    id: 'NOTE.TEXT',
    kind: 'internal',
    type: 'STRING',
    access: 'RW',
    limits: { maxLength: 8 },
    initial: '',
  });
  addTag(f, {
    id: 'CNT.U16',
    kind: 'internal',
    type: 'UINT16',
    access: 'RW',
    limits: { min: 0, max: 65535 },
    initial: 0,
  });
  addTag(f, {
    id: 'SEL.TAB',
    kind: 'internal',
    type: 'INT16',
    access: 'RW',
    limits: { min: 0, max: 5 },
    valueTable: 'TrangThaiBom',
    initial: 0,
  });
  addTag(f, {
    id: 'NO.TABLE',
    kind: 'internal',
    type: 'INT16',
    access: 'RW',
    limits: { min: 0, max: 5 },
    initial: 0,
  });
};
/** Tag RW số không giới hạn: Tag này tự có cảnh báo W_WRITE_NO_LIMITS ở tags.json. */
const free = (f) =>
  addTag(f, { id: 'FREE.SP', kind: 'internal', type: 'FLOAT32', access: 'RW', initial: 1 });
/** n Tag nội bộ `X.Tnnnn` dùng cho các khe nhiều Tag. */
const nTags = (f, n, prefix = 'X', type = 'FLOAT32') => {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}.T${pad(i + 1)}`;
    addTag(f, { id, kind: 'internal', type, initial: type === 'BOOL' ? false : 0 });
    ids.push(id);
  }
  return ids;
};

const slotFor = (widget) =>
  ({
    card: { value: 'TANK01.LEVEL' },
    line: { series: ['TANK01.LEVEL'] },
  })[widget];

/** [tên, hàm sửa base, mã lỗi, mã cảnh báo (tùy chọn), thêm (tùy chọn)] */
export function cases03() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) => C.push([name, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([name, mutate, errors, warnings, extra]);
  const iss = (...issues) => ({ issues });
  const e0 = (code, sub) => at(code, `/items/0${sub}`);
  // một widget hợp lệ/không hợp lệ cô lập trên màn hình main (chỉ số item 0)
  const one = (name, widget, errors, issues, warnings) =>
    bad(
      name,
      (f) => only(f, widget(f)),
      errors,
      warnings,
      issues === undefined ? undefined : iss(...issues),
    );

  // ================= Hợp lệ =================
  ok('v03-valid-full', () => {});
  ok(
    'v03-valid-minimal',
    (f) => {
      f[PJ].screens = ['main'];
      delete f[PJ].navigation;
      delete f[PS];
      f[MS].items = [];
    },
    ['W_SCREEN_EMPTY'],
    iss(at('W_SCREEN_EMPTY', '')),
  );
  ok('v03-valid-no-navigation', (f) => delete f[PJ].navigation);
  ok('v03-valid-navigation-hidden', (f) => (f[PJ].navigation.position = 'hidden'));
  ok('v03-valid-navigation-top', (f) => (f[PJ].navigation.position = 'top'));
  ok('v03-valid-navigation-group', (f) => {
    f[PJ].navigation = {
      position: 'left',
      items: [
        { label: 'Chinh', screen: 'main', icon: 'home' },
        { label: 'Nhom', icon: 'list', items: [{ label: 'Lai chinh', screen: 'main' }] },
      ],
    };
  });
  ok('v03-valid-navigation-all-icons', (f) => {
    const icons = [
      'home',
      'tank',
      'pump',
      'chart',
      'table',
      'gear',
      'bell',
      'bolt',
      'thermo',
      'drop',
      'valve',
      'motor',
      'list',
      'map',
      'doc',
      'user',
    ];
    f[PJ].navigation.items = icons.map((icon) => ({ label: icon, screen: 'main', icon }));
  });
  ok('v03-valid-navigation-label-40', (f) => (f[PJ].navigation.items[0].label = 'L'.repeat(40)));
  ok('v03-valid-no-kind', (f) => delete f[MS].kind);
  ok('v03-valid-background', (f) => (f[MS].background = '#0F172A'));
  ok('v03-valid-background-short', (f) => (f[MS].background = '#fff'));
  for (const fit of ['contain', 'cover', 'stretch', 'fit-width', 'none'])
    ok(`v03-valid-fitmode-${fit}`, (f) => {
      f[MS].fitMode = fit;
      f[PJ].screens = ['main'];
      delete f[PS];
      f[PJ].navigation = undefined;
      // sơ đồ cùng khung: không widget (stretch kèm widget là cảnh báo riêng)
      f[MS].items = f[MS].items.filter((i) => i.type === 'svg');
    });
  ok('v03-valid-no-svg-item', (f) => (f[MS].items = f[MS].items.filter((i) => i.type !== 'svg')));
  ok('v03-valid-svg-hidden-locked', (f) => {
    Object.assign(items(f)[0], { hidden: true, locked: true });
  });
  ok('v03-valid-two-svg-share-svg', (f) => {
    const second = clone(items(f)[0]);
    Object.assign(second, {
      id: 'svg2',
      x: 400,
      y: 400,
      width: 100,
      height: 100,
      bindingFile: 'screens/main2.bindings.json',
    });
    items(f).push(second);
    f['screens/main2.bindings.json'] = {
      schemaVersion: V,
      screenId: 'main',
      itemId: 'svg2',
      elements: [],
    };
  });
  ok('v03-valid-binding-no-itemid', (f) => delete f[MB].itemId);
  ok('v03-valid-navigate-only', (f) =>
    only(f, W('b1', 'button', { events: { click: { action: 'navigate', screen: 'main' } } })),
  );
  ok(
    'v03-warn-item-extreme-position',
    (f) =>
      only(
        f,
        W('p1', 'panel', { x: -2048, y: 8192, width: 8192, height: 8192, props: { title: 'x' } }),
      ),
    ['W_ITEM_OUTSIDE'],
  );
  ok('v03-valid-hidden-widget', (f) => Object.assign(items(f)[2], { hidden: true }));

  // ================= E_SCHEMA =================
  bad(
    'v03-invalid-schema-legacy-screen-keys', // màn hình 0.2 chưa nâng cấp
    (f) => {
      f[MS] = {
        schemaVersion: V,
        id: 'main',
        name: 'Main',
        svgFile: MSVG,
        viewBox: [0, 0, 100, 100],
        fitMode: 'contain',
        bindingFile: MB,
        elements: [{ elementUid: 'el_aaa' }],
      };
    },
    ['E_SCHEMA'],
  );
  bad('v03-invalid-schema-screen-unknown-key', (f) => (f[MS].zoom = 2), ['E_SCHEMA']);
  bad('v03-invalid-schema-no-size', (f) => delete f[MS].size, ['E_SCHEMA']);
  bad('v03-invalid-schema-no-items', (f) => delete f[MS].items, ['E_SCHEMA']);
  bad('v03-invalid-schema-name-empty', (f) => (f[MS].name = ''), ['E_SCHEMA']);
  bad('v03-invalid-schema-fitmode', (f) => (f[MS].fitMode = 'zoom'), ['E_SCHEMA']);
  bad('v03-invalid-schema-background', (f) => (f[MS].background = 'red'), ['E_SCHEMA']);
  bad('v03-invalid-schema-size-fraction', (f) => (f[MS].size.width = 1280.5), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-unknown-key', (f) => (items(f)[2].angle = 90), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-type', (f) => (items(f)[2].type = 'group'), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-x-range', (f) => (items(f)[2].x = 8193), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-width-range', (f) => (items(f)[2].width = 8193), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-width-fraction', (f) => (items(f)[2].height = 20.5), ['E_SCHEMA']);
  bad('v03-invalid-schema-item-no-widget', (f) => delete items(f)[2].widget, ['E_SCHEMA']);
  bad('v03-invalid-schema-svg-no-binding-file', (f) => delete items(f)[0].bindingFile, [
    'E_SCHEMA',
  ]);
  bad('v03-invalid-schema-svg-viewbox', (f) => (items(f)[0].viewBox = [0, 0, 0, 100]), [
    'E_SCHEMA',
  ]);
  bad('v03-invalid-schema-svg-fit', (f) => (items(f)[0].fit = 'fit-width'), ['E_SCHEMA']);
  bad('v03-invalid-schema-svg-has-props', (f) => (items(f)[0].props = {}), ['E_SCHEMA']);
  bad('v03-invalid-schema-widget-has-svgfile', (f) => (items(f)[2].svgFile = MSVG), ['E_SCHEMA']);
  bad('v03-invalid-schema-props-not-object', (f) => (items(f)[2].props = []), ['E_SCHEMA']);
  bad('v03-invalid-schema-tags-value-number', (f) => (items(f)[2].tags.value = 5), ['E_SCHEMA']);
  bad('v03-invalid-schema-security-key', (f) => (items(f)[5].security.maxRole = 'x'), ['E_SCHEMA']);
  bad('v03-invalid-schema-events-key', (f) => (items(f)[6].events.hover = {}), ['E_SCHEMA']);
  bad('v03-invalid-schema-click-not-object', (f) => (items(f)[6].events.click = 'pulse'), [
    'E_SCHEMA',
  ]);
  bad('v03-invalid-schema-nav-icon', (f) => (f[PJ].navigation.items[0].icon = 'rocket'), [
    'E_SCHEMA',
  ]);
  bad('v03-invalid-schema-nav-position', (f) => (f[PJ].navigation.position = 'right'), [
    'E_SCHEMA',
  ]);
  bad('v03-invalid-schema-nav-label-empty', (f) => (f[PJ].navigation.items[0].label = ''), [
    'E_SCHEMA',
  ]);
  bad(
    'v03-invalid-schema-nav-label-41',
    (f) => (f[PJ].navigation.items[0].label = 'L'.repeat(41)),
    ['E_SCHEMA'],
  );
  bad('v03-invalid-schema-nav-unknown-key', (f) => (f[PJ].navigation.badge = 1), ['E_SCHEMA']);
  bad('v03-invalid-schema-nav-no-items', (f) => delete f[PJ].navigation.items, ['E_SCHEMA']);
  bad('v03-invalid-schema-binding-itemid-pattern', (f) => (f[MB].itemId = 'SVG 1'), ['E_SCHEMA']);
  bad(
    'v03-invalid-schema-binding-itemid-mismatch', // luật: itemId khác id của item svg
    (f) => (f[MB].itemId = 'svg9'),
    ['E_SCHEMA'],
    undefined,
    iss(at('E_SCHEMA', '/itemId', MB)),
  );
  bad(
    'v03-invalid-schema-binding-shared', // hai item svg dùng chung một file binding
    (f) => {
      const second = clone(items(f)[0]);
      Object.assign(second, { id: 'svg2', x: 400, y: 400, width: 100, height: 100 });
      items(f).push(second);
    },
    ['E_SCHEMA'],
    undefined,
    iss(at('E_SCHEMA', '/items/10/bindingFile')),
  );
  bad('v03-invalid-schema-project-nav-not-object', (f) => (f[PJ].navigation = []), ['E_SCHEMA']);
  bad('v03-invalid-schema-tag-kind', (f) => (f[TAGS].tags[0].kind = 'virtual'), ['E_SCHEMA']);

  // ================= E_JSON, E_FILE_MISSING, E_PATH =================
  bad('v03-invalid-json-screen', (f) => (f[MS] = '{ "schemaVersion": '), ['E_JSON']);
  bad('v03-invalid-file-missing-screen', (f) => delete f[MS], ['E_FILE_MISSING']);
  bad('v03-invalid-file-missing-popup', (f) => delete f[PS], ['E_FILE_MISSING']);
  bad(
    'v03-invalid-file-missing-svg',
    (f) => delete f[MSVG],
    ['E_FILE_MISSING'],
    undefined,
    iss(at('E_FILE_MISSING', '/items/0/svgFile')),
  );
  bad('v03-invalid-file-missing-binding', (f) => delete f[MB], ['E_FILE_MISSING']);
  bad(
    'v03-invalid-path-svg',
    (f) => (items(f)[0].svgFile = 'screens/../main.svg'),
    ['E_PATH'],
    undefined,
    iss(at('E_PATH', '/items/0/svgFile')),
  );
  bad(
    'v03-invalid-path-binding',
    (f) => (items(f)[0].bindingFile = '/abs/b.json'),
    ['E_PATH'],
    undefined,
    iss(at('E_PATH', '/items/0/bindingFile')),
  );

  // ================= Phiên bản =================
  bad(
    'v03-invalid-version-screen-mixed',
    (f) => (f[PS].schemaVersion = '0.2.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', PS)),
  );
  bad(
    'v03-invalid-version-binding-mixed',
    (f) => (f[MB].schemaVersion = '0.2.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', MB)),
  );
  bad(
    'v03-invalid-version-tags-mixed',
    (f) => (f[TAGS].schemaVersion = '0.2.0'),
    ['E_SCHEMA_VERSION'],
    undefined,
    iss(at('E_SCHEMA_VERSION', '/schemaVersion', TAGS)),
  );
  bad('v03-invalid-version-patch-mixed', (f) => (f[PS].schemaVersion = '0.3.1'), [
    'E_SCHEMA_VERSION',
  ]);
  bad(
    'v03-invalid-min-runtime',
    (f) => (f[PJ].minRuntimeVersion = '0.5.0'),
    ['E_MIN_RUNTIME'],
    undefined,
    iss(at('E_MIN_RUNTIME', '/minRuntimeVersion', PJ)),
  );
  bad(
    'v03-invalid-runtime-too-old',
    (f) => (f[PJ].minRuntimeVersion = '0.9.0'),
    ['E_RUNTIME_TOO_OLD'],
    undefined,
    iss(at('E_RUNTIME_TOO_OLD', '/minRuntimeVersion', PJ)),
  );

  // ================= E_SCREEN_ID, E_SCREEN_KIND, E_SCREEN_SIZE =================
  bad(
    'v03-invalid-screen-id-mismatch',
    (f) => (f[MS].id = 'other'),
    ['E_SCREEN_ID'],
    undefined,
    iss(at('E_SCREEN_ID', '/id')),
  );
  bad(
    'v03-invalid-screen-id-pattern',
    (f) => (f[MS].id = 'Main_1'),
    ['E_SCREEN_ID'],
    undefined,
    iss(at('E_SCREEN_ID', '/id')),
  );
  bad(
    'v03-invalid-screen-binding-screenid',
    (f) => (f[MB].screenId = 'pump'),
    ['E_SCREEN_ID'],
    undefined,
    iss(at('E_SCREEN_ID', '/screenId', MB)),
  );
  bad(
    'v03-invalid-screen-entry-missing',
    (f) => (f[PJ].entryScreen = 'nope'),
    ['E_SCREEN_ID'],
    undefined,
    iss(at('E_SCREEN_ID', '/entryScreen', PJ)),
  );
  bad(
    'v03-invalid-screen-kind',
    (f) => (f[MS].kind = 'dialog'),
    ['E_SCREEN_KIND'],
    undefined,
    iss(at('E_SCREEN_KIND', '/kind')),
  );
  bad(
    'v03-invalid-screen-kind-entry-popup',
    (f) => (f[PJ].entryScreen = 'pump'),
    ['E_SCREEN_KIND'],
    undefined,
    iss(at('E_SCREEN_KIND', '/entryScreen', PJ)),
  );
  const sizeCase = (name, w, h, path) => {
    const sz = (f) => {
      f[MS].size = { width: w, height: h };
      f[MS].items = []; // không phụ thuộc vị trí item
    };
    if (path) bad(name, sz, ['E_SCREEN_SIZE'], undefined, iss(at('E_SCREEN_SIZE', path)));
    else ok(name, sz, ['W_SCREEN_EMPTY']);
  };
  sizeCase('v03-valid-size-64x64', 64, 64);
  sizeCase('v03-invalid-size-width-63', 63, 720, '/size/width');
  sizeCase('v03-invalid-size-height-63', 1280, 63, '/size/height');
  sizeCase('v03-valid-size-4096x2304', 4096, 2304);
  sizeCase('v03-invalid-size-width-4097', 4097, 720, '/size/width');
  sizeCase('v03-invalid-size-height-2305', 1280, 2305, '/size/height');
  sizeCase('v03-invalid-size-zero', 0, 720, '/size/width');
  sizeCase('v03-invalid-size-negative', 1280, -1, '/size/height');

  // ================= E_LIMIT =================
  const manyPanels = (n) => (f) => {
    f[MS].items = Array.from({ length: n }, (_, i) =>
      W(`p${pad(i + 1, 3)}`, 'panel', { x: i, y: i, width: 100, height: 100 }),
    );
  };
  ok('v03-valid-items-250', manyPanels(250));
  bad(
    'v03-invalid-limit-items-251',
    manyPanels(251),
    ['E_LIMIT'],
    undefined,
    iss(at('E_LIMIT', '/items')),
  );
  const manySvg = (n) => (f) => {
    f[MS].items = [];
    for (let i = 0; i < n; i++) {
      const b = `screens/b${i + 1}.bindings.json`;
      f[MS].items.push({
        id: `svg${i + 1}`,
        type: 'svg',
        x: i * 10,
        y: 0,
        width: 100,
        height: 100,
        svgFile: MSVG,
        bindingFile: b,
        viewBox: [0, 0, 100, 100],
        elements: [{ elementUid: 'el_aaa' }],
      });
      f[b] = { schemaVersion: V, screenId: 'main', itemId: `svg${i + 1}`, elements: [] };
    }
  };
  ok('v03-valid-svg-items-8', manySvg(8));
  bad(
    'v03-invalid-limit-svg-items-9',
    manySvg(9),
    ['E_LIMIT'],
    undefined,
    iss(at('E_LIMIT', '/items')),
  );
  const charts = (n) => (f) => {
    only(
      f,
      ...Array.from({ length: n }, (_, i) =>
        W(`c${pad(i + 1, 2)}`, 'bar', { x: 10 + i * 3, tags: { series: ['TANK01.LEVEL'] } }),
      ),
    );
  };
  ok('v03-valid-charts-16', charts(16), []);
  bad(
    'v03-invalid-limit-charts-17',
    charts(17),
    ['E_LIMIT'],
    undefined,
    iss(at('E_LIMIT', '/items')),
  );
  ok('v03-valid-tables-not-charts', (f) =>
    only(
      f,
      ...Array.from({ length: 20 }, (_, i) =>
        W(`t${pad(i + 1, 2)}`, 'tag-table', { x: 10 + i * 3, tags: { rows: ['TANK01.LEVEL'] } }),
      ),
    ),
  );
  const menu = (n) => (f) => {
    f[PJ].navigation.items = Array.from({ length: n }, (_, i) => ({
      label: `M${i + 1}`,
      screen: 'main',
    }));
  };
  ok('v03-valid-nav-leaves-32', menu(32));
  bad(
    'v03-invalid-limit-nav-leaves-33',
    menu(33),
    ['E_LIMIT'],
    undefined,
    iss(at('E_LIMIT', '/navigation/items', PJ)),
  );
  ok('v03-valid-nav-leaves-32-in-group', (f) => {
    f[PJ].navigation.items = [
      {
        label: 'G',
        items: Array.from({ length: 32 }, (_, i) => ({ label: `M${i + 1}`, screen: 'main' })),
      },
    ];
  });
  const slotMax = (name, widget, n, max, type = 'FLOAT32') => {
    ok(`v03-valid-${name}-${max}`, (f) => {
      const ids = nTags(f, max, 'S', type);
      only(f, W('w1', widget, { tags: { [widget === 'tag-table' ? 'rows' : 'series']: ids } }));
    });
    bad(
      `v03-invalid-limit-${name}-${n}`,
      (f) => {
        const ids = nTags(f, n, 'S', type);
        only(f, W('w1', widget, { tags: { [widget === 'tag-table' ? 'rows' : 'series']: ids } }));
      },
      ['E_LIMIT'],
      undefined,
      iss(at('E_LIMIT', `/items/0/tags/${widget === 'tag-table' ? 'rows' : 'series'}`)),
    );
  };
  slotMax('line-series', 'line', 9, 8);
  slotMax('bar-series', 'bar', 13, 12);
  slotMax('pie-series', 'pie', 9, 8);
  slotMax('table-rows', 'tag-table', 51, 50);
  const nScreens = (n) => (f) => {
    f[PJ].screens = ['main'];
    for (let i = 1; i < n; i++) {
      const id = `s${pad(i, 2)}`;
      f[PJ].screens.push(id);
      f[`screens/${id}.screen.json`] = {
        schemaVersion: V,
        id,
        name: id,
        size: { width: 100, height: 100 },
        items: [],
      };
    }
    delete f[PS];
    f[MS].items = f[MS].items.filter((i) => i.id !== 'btn_pump');
  };
  ok('v03-valid-screens-32', nScreens(32), ['W_SCREEN_EMPTY']);
  bad(
    'v03-invalid-limit-screens-33',
    nScreens(33),
    ['E_LIMIT'],
    ['W_SCREEN_EMPTY'],
    iss(at('E_LIMIT', '/screens', PJ)),
  );

  // ================= E_ITEM_ID, E_ITEM_SIZE =================
  const idCase = (name, id) =>
    bad(
      name,
      (f) => only(f, W(id, 'panel')),
      ['E_ITEM_ID'],
      undefined,
      iss(e0('E_ITEM_ID', '/id')),
    );
  idCase('v03-invalid-item-id-uppercase', 'Panel1');
  idCase('v03-invalid-item-id-one-char', 'a');
  idCase('v03-invalid-item-id-digit-first', '1abc');
  idCase('v03-invalid-item-id-dash', 'a-b');
  idCase('v03-invalid-item-id-33', 'a'.repeat(33));
  ok('v03-valid-item-id-32', (f) => only(f, W('a'.repeat(32), 'panel')));
  ok('v03-valid-item-id-2', (f) => only(f, W('a1', 'panel')));
  bad(
    'v03-invalid-item-id-dup',
    (f) => only(f, W('p1', 'panel'), W('p1', 'panel', { x: 400 })),
    ['E_ITEM_ID'],
    undefined,
    iss(at('E_ITEM_ID', '/items/1/id')),
  );
  bad(
    'v03-invalid-item-id-dup-svg-widget',
    (f) => (items(f)[2].id = 'svg1'),
    ['E_ITEM_ID'],
    undefined,
    iss(at('E_ITEM_ID', '/items/2/id')),
  );
  const sizeItem = (name, widget, w, h, errors) => {
    const m = (f) => only(f, W('w1', widget, { width: w, height: h, tags: slotFor(widget) }));
    if (errors.length === 0) ok(name, m);
    else bad(name, m, ['E_ITEM_SIZE'], undefined, iss(...errors.map((p) => e0('E_ITEM_SIZE', p))));
  };
  sizeItem('v03-valid-item-size-card-min', 'card', 96, 56, []);
  sizeItem('v03-invalid-item-size-card-width-95', 'card', 95, 56, ['/width']);
  sizeItem('v03-invalid-item-size-card-height-55', 'card', 96, 55, ['/height']);
  sizeItem('v03-invalid-item-size-card-both', 'card', 10, 10, ['/width', '/height']);
  sizeItem('v03-invalid-item-size-zero', 'panel', 0, 100, ['/width']);
  sizeItem('v03-invalid-item-size-negative', 'panel', 100, -5, ['/height']);
  sizeItem('v03-valid-item-size-panel-min', 'panel', 80, 60, []);
  sizeItem('v03-invalid-item-size-panel-79', 'panel', 79, 60, ['/width']);
  sizeItem('v03-valid-item-size-line-min', 'line', 240, 140, []);
  sizeItem('v03-invalid-item-size-line-139', 'line', 240, 139, ['/height']);
  sizeItem('v03-valid-item-size-button-min', 'button', 64, 32, []);
  sizeItem('v03-invalid-item-size-button-31', 'button', 64, 31, ['/height']);
  bad(
    'v03-invalid-item-size-svg-zero',
    (f) => (items(f)[0].width = 0),
    ['E_ITEM_SIZE'],
    undefined,
    iss(at('E_ITEM_SIZE', '/items/0/width')),
  );

  // ================= Item svg: E_DUP_UID, E_REF_UID, binding =================
  bad(
    'v03-invalid-svg-dup-uid',
    (f) => items(f)[0].elements.push({ elementUid: 'el_aaa' }),
    ['E_DUP_UID'],
    undefined,
    iss(at('E_DUP_UID', '/items/0/elements/3/elementUid')),
  );
  bad(
    'v03-invalid-svg-ref-uid',
    (f) => items(f)[0].elements.pop(),
    ['E_REF_UID'],
    undefined,
    iss(at('E_REF_UID', '/elements/2/elementUid', MB)),
  );
  bad(
    'v03-invalid-svg-dup-uid-bindings',
    (f) => f[MB].elements.push({ elementUid: 'el_aaa', bindings: [f[MB].elements[0].bindings[0]] }),
    ['E_DUP_UID', 'E_DUP_BINDING'],
    undefined,
    iss(at('E_DUP_UID', '/elements/3/elementUid', MB)),
  );
  bad(
    'v03-invalid-svg-dup-binding',
    (f) => (f[MB].elements[1].bindings[0].id = 'b1'),
    ['E_DUP_BINDING'],
    undefined,
    iss(at('E_DUP_BINDING', '/elements/1/bindings/0/id', MB)),
  );
  bad(
    'v03-invalid-svg-binding-ref-tag',
    (f) => (f[MB].elements[0].bindings[0].source.tagId = 'NOPE.TAG'),
    ['E_REF_TAG'],
    undefined,
    iss(at('E_REF_TAG', '/elements/0/bindings/0/source/tagId', MB)),
  );
  bad(
    'v03-invalid-svg-binding-target',
    (f) => (f[MB].elements[0].bindings[0].target = 'transform.scale'),
    ['E_TARGET_UNSUPPORTED'],
    undefined,
    iss(at('E_TARGET_UNSUPPORTED', '/elements/0/bindings/0/target', MB)),
  );
  bad(
    'v03-invalid-svg-binding-type',
    (f) => (f[MB].elements[0].bindings[0].source.tagId = 'PUMP01.NAME'),
    ['E_TYPE_MISMATCH'],
    undefined,
    iss(at('E_TYPE_MISMATCH', '/elements/0/bindings/0/source/tagId', MB)),
  );
  bad(
    'v03-invalid-svg-binding-table',
    (f) => (f[MB].elements[2].bindings[1].transform.table = 'KhongCo'),
    ['E_REF_TABLE'],
    undefined,
    iss(at('E_REF_TABLE', '/elements/2/bindings/1/transform/table', MB)),
  );
  bad(
    'v03-invalid-svg-binding-transform',
    (f) => (f[MB].elements[0].bindings[0].transform = { kind: 'expression' }),
    ['E_TRANSFORM_UNSUPPORTED'],
    undefined,
    iss(at('E_TRANSFORM_UNSUPPORTED', '/elements/0/bindings/0/transform/kind', MB)),
  );
  bad(
    'v03-invalid-svg-binding-scale-range',
    (f) =>
      (f[MB].elements[0].bindings[0].transform = {
        kind: 'linearScale',
        inMin: 5,
        inMax: 5,
        outMin: 0,
        outMax: 1,
      }),
    ['E_SCALE_RANGE'],
    undefined,
    iss(at('E_SCALE_RANGE', '/elements/0/bindings/0/transform', MB)),
  );

  // ================= Widget: E_WIDGET_UNKNOWN, E_WIDGET_SLOT =================
  one(
    'v03-invalid-widget-unknown',
    () => W('x1', 'gizmo'),
    ['E_WIDGET_UNKNOWN'],
    [e0('E_WIDGET_UNKNOWN', '/widget')],
  );
  one(
    'v03-invalid-widget-unknown-case',
    () => W('x1', 'Card'),
    ['E_WIDGET_UNKNOWN'],
    [e0('E_WIDGET_UNKNOWN', '/widget')],
  );
  one(
    'v03-invalid-slot-unknown',
    () => W('x1', 'card', { tags: { value: 'TANK01.LEVEL', extra: 'TANK01.SP' } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/extra')],
  );
  one(
    'v03-invalid-slot-required-missing',
    () => W('x1', 'card', { tags: {} }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  one(
    'v03-invalid-slot-required-no-tags-key',
    () => W('x1', 'gauge'),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  one(
    'v03-invalid-slot-panel-has-tags',
    () => W('x1', 'panel', { tags: { value: 'TANK01.LEVEL' } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/value')],
  );
  one(
    'v03-invalid-slot-multi-string',
    () => W('x1', 'line', { tags: { series: 'TANK01.LEVEL' } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/series')],
  );
  one(
    'v03-invalid-slot-single-array',
    () => W('x1', 'card', { tags: { value: ['TANK01.LEVEL'] } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/value')],
  );
  one(
    'v03-invalid-slot-multi-empty',
    () => W('x1', 'line', { tags: { series: [] } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/series')],
  );
  one(
    'v03-invalid-slot-multi-dup',
    () => W('x1', 'bar', { tags: { series: ['TANK01.LEVEL', 'TANK01.SP', 'TANK01.LEVEL'] } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/series/2')],
  );
  one(
    'v03-invalid-slot-multi-not-string',
    () => W('x1', 'bar', { tags: { series: ['TANK01.LEVEL', 7] } }),
    ['E_SCHEMA'],
  );
  one(
    'v03-invalid-slot-button-write-no-target',
    () => W('x1', 'button', { events: { click: { action: 'write', value: 1 } } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  one(
    'v03-invalid-slot-button-toggle-no-target',
    () => W('x1', 'button', { events: { click: { action: 'toggle' } } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  one(
    'v03-invalid-slot-button-pulse-no-target',
    () =>
      W('x1', 'button', { events: { click: { action: 'pulse', value: true, durationMs: 500 } } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  one(
    'v03-invalid-slot-button-navigate-with-target',
    () =>
      W('x1', 'button', {
        tags: { target: 'PUMP01.RUN_CMD' },
        events: { click: { action: 'navigate', screen: 'main' } },
      }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/target')],
  );
  one(
    'v03-invalid-slot-button-popup-with-target',
    () =>
      W('x1', 'button', {
        tags: { target: 'PUMP01.RUN_CMD' },
        events: { click: { action: 'popup', screen: 'pump' } },
      }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/target')],
  );
  one(
    'v03-invalid-slot-button-no-event-with-target',
    () => W('x1', 'button', { tags: { target: 'PUMP01.RUN_CMD' } }),
    ['E_WIDGET_SLOT'],
    [e0('E_WIDGET_SLOT', '/tags/target')],
  );
  ok('v03-valid-button-no-event-no-target', (f) => only(f, W('x1', 'button')));
  ok('v03-valid-label-no-tag', (f) => only(f, W('x1', 'label', { props: { text: 'Xin chao' } })));
  ok('v03-valid-label-with-tag', (f) =>
    only(f, W('x1', 'label', { tags: { value: 'PUMP01.NAME' } })),
  );

  // ================= E_WIDGET_PROP =================
  const prop = (name, widget, props, tags, path, errors = ['E_WIDGET_PROP']) =>
    one(name, () => W('x1', widget, { props, tags }), errors, [e0(errors[0], path)]);
  const cardTag = { value: 'TANK01.LEVEL' };
  const okProp = (name, widget, props, tags) =>
    ok(name, (f) => only(f, W('x1', widget, { props, tags })));
  prop('v03-invalid-prop-unknown', 'card', { color: '#FF0000' }, cardTag, '/props/color');
  prop('v03-invalid-prop-type-string', 'card', { decimals: '1' }, cardTag, '/props/decimals');
  prop('v03-invalid-prop-type-float', 'card', { decimals: 1.5 }, cardTag, '/props/decimals');
  okProp('v03-valid-prop-decimals-0', 'card', { decimals: 0 }, cardTag);
  okProp('v03-valid-prop-decimals-6', 'card', { decimals: 6 }, cardTag);
  prop('v03-invalid-prop-decimals-7', 'card', { decimals: 7 }, cardTag, '/props/decimals');
  prop('v03-invalid-prop-decimals-negative', 'card', { decimals: -1 }, cardTag, '/props/decimals');
  prop('v03-invalid-prop-enum', 'card', { fontSize: 'xxl' }, cardTag, '/props/fontSize');
  okProp('v03-valid-prop-enum-xl', 'card', { fontSize: 'xl' }, cardTag);
  prop(
    'v03-invalid-prop-color-short',
    'card',
    { background: '#12345' },
    cardTag,
    '/props/background',
  );
  prop('v03-invalid-prop-color-rgb', 'card', { background: '#123' }, cardTag, '/props/background');
  okProp(
    'v03-valid-prop-color-auto',
    'card',
    { background: 'auto', valueColor: '#A1B2C3' },
    cardTag,
  );
  prop(
    'v03-invalid-prop-color-auto-not-allowed',
    'gauge',
    { zones: [{ from: 0, to: 10, color: 'auto' }] },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  prop('v03-invalid-prop-label-41', 'card', { label: 'L'.repeat(41) }, cardTag, '/props/label');
  okProp('v03-valid-prop-label-40', 'card', { label: 'L'.repeat(40) }, cardTag);
  prop('v03-invalid-prop-bool', 'card', { showQuality: 'yes' }, cardTag, '/props/showQuality');
  prop('v03-invalid-prop-unit-17', 'card', { unit: 'u'.repeat(17) }, cardTag, '/props/unit');
  okProp('v03-valid-prop-unit-empty', 'card', { unit: '' }, cardTag);
  prop('v03-invalid-prop-fontsize-label', 'label', { fontSize: 7 }, {}, '/props/fontSize');
  okProp('v03-valid-prop-fontsize-label-8', 'label', { fontSize: 8, text: 'a' }, {});
  okProp('v03-valid-prop-fontsize-label-200', 'label', { fontSize: 200 }, {});
  prop('v03-invalid-prop-fontsize-label-201', 'label', { fontSize: 201 }, {}, '/props/fontSize');
  prop('v03-invalid-prop-label-text-201', 'label', { text: 't'.repeat(201) }, {}, '/props/text');
  prop(
    'v03-invalid-prop-lamp-shape',
    'lamp',
    { shape: 'triangle' },
    { state: 'PUMP01.FAULT' },
    '/props/shape',
  );
  prop(
    'v03-invalid-prop-panel-title-61',
    'panel',
    { title: 't'.repeat(61) },
    undefined,
    '/props/title',
  );
  prop(
    'v03-invalid-prop-gauge-minmax-type',
    'gauge',
    { min: '0' },
    { value: 'TANK01.LEVEL' },
    '/props/min',
  );
  okProp(
    'v03-valid-prop-zones-4',
    'gauge',
    { zones: [0, 1, 2, 3].map((i) => ({ from: i * 10, to: i * 10 + 10, color: '#00FF00' })) },
    { value: 'TANK01.LEVEL' },
  );
  prop(
    'v03-invalid-prop-zones-5',
    'gauge',
    { zones: [0, 1, 2, 3, 4].map((i) => ({ from: i * 10, to: i * 10 + 10, color: '#00FF00' })) },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  prop(
    'v03-invalid-prop-zones-overlap',
    'level',
    {
      zones: [
        { from: 0, to: 50, color: '#00FF00' },
        { from: 40, to: 80, color: '#FF0000' },
      ],
    },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  prop(
    'v03-invalid-prop-zones-from-ge-to',
    'gauge',
    { zones: [{ from: 50, to: 50, color: '#00FF00' }] },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  prop(
    'v03-invalid-prop-zones-extra-field',
    'gauge',
    { zones: [{ from: 0, to: 5, color: '#00FF00', label: 'x' }] },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  prop(
    'v03-invalid-prop-zones-missing-field',
    'gauge',
    { zones: [{ from: 0, to: 5 }] },
    { value: 'TANK01.LEVEL' },
    '/props/zones',
  );
  okProp(
    'v03-valid-prop-zones-touching',
    'gauge',
    {
      zones: [
        { from: 0, to: 50, color: '#00FF00' },
        { from: 50, to: 80, color: '#FF0000' },
      ],
    },
    { value: 'TANK01.LEVEL' },
  );
  okProp(
    'v03-valid-prop-level-horizontal',
    'level',
    { orientation: 'horizontal' },
    { value: 'TANK01.LEVEL' },
  );
  prop(
    'v03-invalid-prop-level-orientation',
    'level',
    { orientation: 'diagonal' },
    { value: 'TANK01.LEVEL' },
    '/props/orientation',
  );
  const lineTags = { series: ['TANK01.LEVEL', 'TANK01.SP'] };
  okProp('v03-valid-prop-line-window-10', 'line', { windowSec: 10 }, lineTags);
  prop('v03-invalid-prop-line-window-9', 'line', { windowSec: 9 }, lineTags, '/props/windowSec');
  okProp('v03-valid-prop-line-window-3600', 'line', { windowSec: 3600 }, lineTags);
  prop(
    'v03-invalid-prop-line-window-3601',
    'line',
    { windowSec: 3601 },
    lineTags,
    '/props/windowSec',
  );
  okProp('v03-valid-prop-line-sample-250', 'line', { sampleMs: 250 }, lineTags);
  prop('v03-invalid-prop-line-sample-249', 'line', { sampleMs: 249 }, lineTags, '/props/sampleMs');
  okProp('v03-valid-prop-line-sample-60000', 'line', { sampleMs: 60000 }, lineTags);
  prop(
    'v03-invalid-prop-line-sample-60001',
    'line',
    { sampleMs: 60001 },
    lineTags,
    '/props/sampleMs',
  );
  okProp('v03-valid-prop-line-ymin-ymax', 'line', { yMin: 0, yMax: 100 }, lineTags);
  prop('v03-invalid-prop-line-ymin-only', 'line', { yMin: 0 }, lineTags, '/props/yMin');
  prop('v03-invalid-prop-line-ymax-only', 'line', { yMax: 10 }, lineTags, '/props/yMax');
  prop(
    'v03-invalid-prop-line-ymin-ge-ymax',
    'line',
    { yMin: 10, yMax: 10 },
    lineTags,
    '/props/yMax',
  );
  okProp('v03-valid-prop-line-labels', 'line', { labels: ['A', 'B'] }, lineTags);
  prop(
    'v03-invalid-prop-line-labels-too-many',
    'line',
    { labels: ['A', 'B', 'C'] },
    lineTags,
    '/props/labels',
  );
  prop(
    'v03-invalid-prop-line-labels-too-long',
    'line',
    { labels: ['L'.repeat(41)] },
    lineTags,
    '/props/labels',
  );
  prop(
    'v03-invalid-prop-bar-labels-too-many',
    'bar',
    { labels: ['A', 'B', 'C'] },
    lineTags,
    '/props/labels',
  );
  prop(
    'v03-invalid-prop-pie-labels-too-many',
    'pie',
    { labels: ['A', 'B', 'C'] },
    lineTags,
    '/props/labels',
  );
  prop(
    'v03-invalid-prop-table-labels-too-many',
    'tag-table',
    { labels: ['A', 'B', 'C'] },
    { rows: ['TANK01.LEVEL', 'TANK01.SP'] },
    '/props/labels',
  );
  okProp(
    'v03-valid-prop-bar-minmax',
    'bar',
    { min: 0, max: 10, orientation: 'horizontal' },
    lineTags,
  );
  okProp(
    'v03-valid-prop-pie',
    'pie',
    { donut: false, showTotal: true, showPercent: false },
    lineTags,
  );
  okProp(
    'v03-valid-prop-table-columns',
    'tag-table',
    { columns: ['label', 'value', 'unit', 'quality', 'updated'] },
    { rows: ['TANK01.LEVEL'] },
  );
  prop(
    'v03-invalid-prop-table-columns-dup',
    'tag-table',
    { columns: ['label', 'label'] },
    { rows: ['TANK01.LEVEL'] },
    '/props/columns',
  );
  prop(
    'v03-invalid-prop-table-columns-unknown',
    'tag-table',
    { columns: ['label', 'size'] },
    { rows: ['TANK01.LEVEL'] },
    '/props/columns',
  );
  prop(
    'v03-invalid-prop-table-columns-6',
    'tag-table',
    { columns: ['label', 'value', 'unit', 'quality', 'updated', 'label'] },
    { rows: ['TANK01.LEVEL'] },
    '/props/columns',
  );
  prop(
    'v03-invalid-prop-setpoint-step-zero',
    'setpoint',
    { step: 0 },
    { target: 'TANK01.SP' },
    '/props/step',
  );
  prop(
    'v03-invalid-prop-setpoint-step-negative',
    'setpoint',
    { step: -1 },
    { target: 'TANK01.SP' },
    '/props/step',
  );
  okProp(
    'v03-valid-prop-setpoint-step',
    'setpoint',
    { step: 0.5, decimals: 2 },
    { target: 'TANK01.SP' },
  );
  prop(
    'v03-invalid-prop-switch-ontext-17',
    'switch',
    { onText: 'o'.repeat(17) },
    { target: 'PUMP01.RUN_CMD' },
    '/props/onText',
  );
  prop(
    'v03-invalid-prop-button-variant',
    'button',
    { variant: 'success' },
    undefined,
    '/props/variant',
  );
  prop(
    'v03-invalid-prop-button-confirm',
    'button',
    { confirm: 'never' },
    undefined,
    '/props/confirm',
  );
  prop(
    'v03-invalid-prop-confirmtext-201',
    'button',
    { confirmText: 'c'.repeat(201) },
    undefined,
    '/props/confirmText',
  );
  prop(
    'v03-invalid-prop-setpoint-no-confirm',
    'setpoint',
    { confirm: 'none' },
    { target: 'TANK01.SP' },
    '/props/confirm',
  );
  prop(
    'v03-invalid-prop-slider-orientation',
    'slider',
    { orientation: 'up' },
    { target: 'TANK01.SP' },
    '/props/orientation',
  );
  prop(
    'v03-invalid-prop-select-table-type',
    'select',
    { table: 5 },
    { target: 'SEL.TAB' },
    '/props/table',
  );
  one(
    'v03-invalid-prop-security-on-display',
    () => W('x1', 'card', { tags: cardTag, security: { minRole: 'operator' } }),
    ['E_WIDGET_PROP'],
    [e0('E_WIDGET_PROP', '/security')],
  );
  one(
    'v03-invalid-prop-events-on-display',
    () => W('x1', 'card', { tags: cardTag, events: { click: { action: 'closePopup' } } }),
    ['E_WIDGET_PROP'],
    [e0('E_WIDGET_PROP', '/events')],
  );
  one(
    'v03-invalid-prop-events-on-switch',
    () =>
      W('x1', 'switch', {
        tags: { target: 'PUMP01.RUN_CMD' },
        events: { click: { action: 'toggle' } },
      }),
    ['E_WIDGET_PROP'],
    [e0('E_WIDGET_PROP', '/events')],
  );
  one(
    'v03-invalid-prop-select-no-table',
    () => W('x1', 'select', { tags: { target: 'NO.TABLE' } }),
    ['E_WIDGET_PROP'],
    [e0('E_WIDGET_PROP', '/props')],
  );
  ok('v03-valid-prop-select-table-of-tag', (f) =>
    only(f, W('x1', 'select', { tags: { target: 'SEL.TAB' } })),
  );
  ok('v03-valid-prop-select-table-prop', (f) => {
    only(f, W('x1', 'select', { props: { table: 'TrangThaiBom' }, tags: { target: 'NO.TABLE' } }));
  });

  // ================= E_WIDGET_TAG_TYPE, E_REF_TAG, E_REF_TABLE, E_TAG_ACCESS =================
  const tagc = (name, widget, tags, errors, path, props, events) =>
    bad(
      name,
      (f) => {
        only(
          f,
          W('x1', widget, { tags, ...(props ? { props } : {}), ...(events ? { events } : {}) }),
        );
      },
      errors,
      undefined,
      iss(e0(errors[0], path)),
    );
  tagc(
    'v03-invalid-tagtype-gauge-bool',
    'gauge',
    { value: 'PUMP01.FAULT' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/value',
  );
  tagc(
    'v03-invalid-tagtype-gauge-string',
    'gauge',
    { value: 'PUMP01.NAME' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/value',
  );
  tagc(
    'v03-invalid-tagtype-lamp-string',
    'lamp',
    { state: 'PUMP01.NAME' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/state',
  );
  tagc(
    'v03-invalid-tagtype-level-bool',
    'level',
    { value: 'PUMP01.FAULT' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/value',
  );
  tagc(
    'v03-invalid-tagtype-line-string',
    'line',
    { series: ['TANK01.LEVEL', 'PUMP01.NAME'] },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/series/1',
  );
  tagc(
    'v03-invalid-tagtype-pie-bool',
    'pie',
    { series: ['TANK01.LEVEL', 'PUMP01.FAULT'] },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/series/1',
  );
  tagc(
    'v03-invalid-tagtype-bar-string',
    'bar',
    { series: ['PUMP01.NAME'] },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/series/0',
  );
  tagc(
    'v03-invalid-tagtype-switch-number',
    'switch',
    { target: 'TANK01.SP' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-tagtype-setpoint-bool',
    'setpoint',
    { target: 'PUMP01.RUN_CMD' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-tagtype-setpoint-string',
    'setpoint',
    { target: 'NOTE.TEXT' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-tagtype-select-string',
    'select',
    { target: 'NOTE.TEXT' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
    { table: 'TrangThaiBom' },
  );
  tagc(
    'v03-invalid-tagtype-toggle-number',
    'button',
    { target: 'TANK01.SP' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
    undefined,
    { click: { action: 'toggle' } },
  );
  tagc(
    'v03-invalid-tagtype-pulse-number',
    'button',
    { target: 'TANK01.SP' },
    ['E_WIDGET_TAG_TYPE'],
    '/tags/target',
    undefined,
    { click: { action: 'pulse', value: true, durationMs: 500 } },
  );
  tagc('v03-invalid-ref-tag-card', 'card', { value: 'NOPE.TAG' }, ['E_REF_TAG'], '/tags/value');
  tagc(
    'v03-invalid-ref-tag-line',
    'line',
    { series: ['TANK01.LEVEL', 'NOPE.TAG'] },
    ['E_REF_TAG'],
    '/tags/series/1',
  );
  tagc('v03-invalid-ref-tag-case', 'card', { value: 'tank01.level' }, ['E_REF_TAG'], '/tags/value');
  tagc(
    'v03-invalid-ref-tag-button-target',
    'button',
    { target: 'NOPE.CMD' },
    ['E_REF_TAG'],
    '/tags/target',
    undefined,
    { click: { action: 'toggle' } },
  );
  tagc(
    'v03-invalid-ref-table-select',
    'select',
    { target: 'NO.TABLE' },
    ['E_REF_TABLE'],
    '/props/table',
    { table: 'KhongCo' },
  );
  tagc(
    'v03-invalid-access-switch-readonly',
    'switch',
    { target: 'PUMP01.FAULT' },
    ['E_TAG_ACCESS'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-access-setpoint-readonly',
    'setpoint',
    { target: 'TANK01.LEVEL' },
    ['E_TAG_ACCESS'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-access-setpoint-calculated',
    'setpoint',
    { target: 'TANK01.VOLUME' },
    ['E_TAG_ACCESS'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-access-slider-simulation',
    'slider',
    { target: 'DEMO.WAVE' },
    ['E_TAG_ACCESS'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-access-select-readonly',
    'select',
    { target: 'PUMP01.STATE' },
    ['E_TAG_ACCESS'],
    '/tags/target',
  );
  tagc(
    'v03-invalid-access-button-write-readonly',
    'button',
    { target: 'PUMP01.FAULT' },
    ['E_TAG_ACCESS'],
    '/tags/target',
    undefined,
    { click: { action: 'write', value: true } },
  );
  tagc(
    'v03-invalid-access-button-toggle-readonly',
    'button',
    { target: 'PUMP01.FAULT' },
    ['E_TAG_ACCESS'],
    '/tags/target',
    undefined,
    { click: { action: 'toggle' } },
  );
  ok('v03-valid-access-slider-manual-simulation', (f) =>
    only(f, W('x1', 'slider', { tags: { target: 'DEMO.SET' } })),
  );
  ok('v03-valid-access-setpoint-internal', (f) =>
    only(f, W('x1', 'setpoint', { tags: { target: 'TANK01.SP_HI' } })),
  );
  ok('v03-valid-readonly-tags-in-display', (f) =>
    only(
      f,
      W('x1', 'card', { x: 10, tags: { value: 'TANK01.VOLUME' } }),
      W('x2', 'card', { x: 320, tags: { value: 'DEMO.WAVE' } }),
      W('x3', 'lamp', { x: 630, tags: { state: 'TANK01.HIGH' } }),
      W('x4', 'card', { x: 940, tags: { value: 'PUMP01.STATE_TEXT' } }),
      W('x5', 'level', { x: 10, y: 300, tags: { value: 'METER1.P' } }),
    ),
  );

  // ================= E_WIDGET_LIMITS, W_WRITE_NO_LIMITS =================
  const lim = (name, widget, props, target, errors, path, warnings) =>
    bad(
      name,
      (f) => {
        if (target === 'FREE.SP') free(f);
        const tags =
          typeof target === 'string' && !target.startsWith('@')
            ? { target }
            : target === '@gauge'
              ? { value: 'TANK01.LEVEL' }
              : { series: ['TANK01.LEVEL'] };
        only(f, W('x1', widget, { props, tags }));
      },
      errors,
      warnings,
      errors.length ? iss(e0(errors[0], path)) : undefined,
    );
  lim(
    'v03-invalid-limits-setpoint-min-below',
    'setpoint',
    { min: -1, max: 50 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/min',
  );
  lim(
    'v03-invalid-limits-setpoint-max-above',
    'setpoint',
    { min: 0, max: 91 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-slider-min-below',
    'slider',
    { min: -1 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/min',
  );
  lim(
    'v03-invalid-limits-slider-max-above',
    'slider',
    { max: 100 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-setpoint-min-eq-max',
    'setpoint',
    { min: 10, max: 10 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-setpoint-min-gt-max',
    'setpoint',
    { min: 60, max: 10 },
    'TANK01.SP',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-setpoint-min-gt-max-nolimits',
    'setpoint',
    { min: 60, max: 10 },
    'FREE.SP',
    ['E_WIDGET_LIMITS'],
    '/props/max',
    ['W_WRITE_NO_LIMITS'],
  );
  lim(
    'v03-invalid-limits-gauge-min-eq-max',
    'gauge',
    { min: 5, max: 5 },
    '@gauge',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-bar-min-gt-max',
    'bar',
    { min: 9, max: 1 },
    '@bar',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  lim(
    'v03-invalid-limits-level-min-gt-max',
    'level',
    { min: 9, max: 1 },
    '@gauge',
    ['E_WIDGET_LIMITS'],
    '/props/max',
  );
  ok('v03-valid-limits-setpoint-equal-tag', (f) =>
    only(f, W('x1', 'setpoint', { props: { min: 0, max: 90 }, tags: { target: 'TANK01.SP' } })),
  );
  ok('v03-valid-limits-setpoint-inside-tag', (f) =>
    only(f, W('x1', 'setpoint', { props: { min: 10, max: 80 }, tags: { target: 'TANK01.SP' } })),
  );
  ok('v03-valid-limits-setpoint-default-from-tag', (f) =>
    only(f, W('x1', 'setpoint', { tags: { target: 'TANK01.SP' } })),
  );
  ok(
    'v03-warn-write-no-limits-setpoint',
    (f) => {
      free(f);
      only(f, W('x1', 'setpoint', { tags: { target: 'FREE.SP' } }));
    },
    ['W_WRITE_NO_LIMITS'],
    iss(e0('W_WRITE_NO_LIMITS', '/tags/target')),
  );
  ok(
    'v03-warn-write-no-limits-slider',
    (f) => {
      free(f);
      only(f, W('x1', 'slider', { tags: { target: 'FREE.SP' } }));
    },
    ['W_WRITE_NO_LIMITS'],
    iss(e0('W_WRITE_NO_LIMITS', '/tags/target')),
  );
  ok(
    'v03-valid-write-limits-from-widget-only',
    (f) => {
      free(f);
      only(f, W('x1', 'setpoint', { props: { min: 0, max: 10 }, tags: { target: 'FREE.SP' } }));
    },
    ['W_WRITE_NO_LIMITS'], // cảnh báo của chính Tag FREE.SP ở tags.json
  );

  // ================= E_WIDGET_MINROLE, E_WIDGET_CONFIRM, W_CONFIRM_NONE =================
  const role = (name, minRole, errors) => {
    const m = (f) =>
      only(f, W('x1', 'switch', { tags: { target: 'PUMP01.RUN_CMD' }, security: { minRole } }));
    if (errors)
      bad(
        name,
        m,
        ['E_WIDGET_MINROLE'],
        undefined,
        iss(e0('E_WIDGET_MINROLE', '/security/minRole')),
      );
    else ok(name, m);
  };
  role('v03-invalid-minrole-viewer', 'viewer', true);
  role('v03-invalid-minrole-unknown', 'root', true);
  role('v03-invalid-minrole-case', 'Operator', true);
  role('v03-valid-minrole-operator', 'operator', false);
  role('v03-valid-minrole-engineer', 'engineer', false);
  role('v03-valid-minrole-administrator', 'administrator', false);
  ok('v03-valid-security-empty', (f) =>
    only(f, W('x1', 'switch', { tags: { target: 'PUMP01.RUN_CMD' }, security: {} })),
  );
  bad(
    'v03-invalid-confirm-none-number',
    (f) =>
      only(
        f,
        W('x1', 'button', {
          props: { confirm: 'none' },
          tags: { target: 'TANK01.SP' },
          events: { click: { action: 'write', value: 5 } },
        }),
      ),
    ['E_WIDGET_CONFIRM'],
    ['W_CONFIRM_NONE'],
    iss(e0('E_WIDGET_CONFIRM', '/props/confirm'), e0('W_CONFIRM_NONE', '/props/confirm')),
  );
  bad(
    'v03-invalid-confirm-none-string',
    (f) => {
      only(
        f,
        W('x1', 'button', {
          props: { confirm: 'none' },
          tags: { target: 'NOTE.TEXT' },
          events: { click: { action: 'write', value: 'ab' } },
        }),
      );
    },
    ['E_WIDGET_CONFIRM'],
    ['W_CONFIRM_NONE'],
    iss(e0('E_WIDGET_CONFIRM', '/props/confirm')),
  );
  ok(
    'v03-warn-confirm-none-bool',
    (f) =>
      only(
        f,
        W('x1', 'button', {
          props: { confirm: 'none' },
          tags: { target: 'PUMP01.RUN_CMD' },
          events: { click: { action: 'toggle' } },
        }),
      ),
    ['W_CONFIRM_NONE'],
    iss(e0('W_CONFIRM_NONE', '/props/confirm')),
  );
  ok(
    'v03-warn-confirm-none-switch',
    (f) =>
      only(
        f,
        W('x1', 'switch', { props: { confirm: 'none' }, tags: { target: 'PUMP01.RUN_CMD' } }),
      ),
    ['W_CONFIRM_NONE'],
    iss(e0('W_CONFIRM_NONE', '/props/confirm')),
  );
  bad(
    'v03-invalid-confirm-none-nav-no-tag',
    (f) =>
      only(
        f,
        W('x1', 'button', {
          props: { confirm: 'none' },
          events: { click: { action: 'navigate', screen: 'main' } },
        }),
      ),
    [],
    ['W_CONFIRM_NONE'],
  );

  // ================= E_ACTION, E_ACTION_TARGET, W_PULSE_READBACK, W_ACTION_NOOP =================
  const act = (name, click, tag, errors, path, warnings, setup) => {
    const m = (f) => {
      setup?.(f);
      only(f, W('x1', 'button', { ...(tag ? { tags: { target: tag } } : {}), events: { click } }));
    };
    if (errors.length === 0) ok(name, m, warnings ?? []);
    else bad(name, m, errors, warnings, iss(e0(errors[0], path)));
  };
  act(
    'v03-invalid-action-unknown',
    { action: 'reboot' },
    null,
    ['E_ACTION'],
    '/events/click/action',
  );
  act('v03-invalid-action-missing', { value: 1 }, 'TANK01.SP', ['E_ACTION'], '/events/click');
  act('v03-invalid-action-not-string', { action: 5 }, null, ['E_ACTION'], '/events/click/action');
  act(
    'v03-invalid-action-write-no-value',
    { action: 'write' },
    'TANK01.SP',
    ['E_ACTION'],
    '/events/click',
  );
  act(
    'v03-invalid-action-extra-key',
    { action: 'toggle', value: true },
    'PUMP01.RUN_CMD',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-invalid-action-closepopup-extra',
    { action: 'closePopup', screen: 'main' },
    null,
    ['E_ACTION'],
    '/events/click/screen',
    ['W_ACTION_NOOP'],
  );
  act(
    'v03-invalid-action-navigate-no-screen',
    { action: 'navigate' },
    null,
    ['E_ACTION'],
    '/events/click',
  );
  act(
    'v03-invalid-action-navigate-screen-type',
    { action: 'navigate', screen: 5 },
    null,
    ['E_ACTION'],
    '/events/click/screen',
  );
  act(
    'v03-invalid-action-write-wrong-type-bool',
    { action: 'write', value: 1 },
    'PUMP01.RUN_CMD',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-invalid-action-write-wrong-type-number',
    { action: 'write', value: '5' },
    'TANK01.SP',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-invalid-action-write-wrong-type-string',
    { action: 'write', value: 5 },
    'NOTE.TEXT',
    ['E_ACTION'],
    '/events/click/value',
  );
  act('v03-valid-action-write-limit-max', { action: 'write', value: 90 }, 'TANK01.SP', []);
  act('v03-valid-action-write-limit-min', { action: 'write', value: 0 }, 'TANK01.SP', []);
  act(
    'v03-invalid-action-write-above-limit',
    { action: 'write', value: 91 },
    'TANK01.SP',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-invalid-action-write-below-limit',
    { action: 'write', value: -0.5 },
    'TANK01.SP',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-invalid-action-write-fraction-integer-tag',
    { action: 'write', value: 1.5 },
    'DEMO.SET',
    ['E_ACTION'],
    '/events/click/value',
  );
  act('v03-valid-action-write-integer-tag', { action: 'write', value: -100 }, 'DEMO.SET', []);
  act(
    'v03-invalid-action-write-outside-type',
    { action: 'write', value: 70000 },
    'CNT.U16',
    ['E_ACTION'],
    '/events/click/value',
  );
  act('v03-valid-action-write-type-max', { action: 'write', value: 65535 }, 'CNT.U16', []);
  act('v03-valid-action-write-string', { action: 'write', value: 'abcdefgh' }, 'NOTE.TEXT', []);
  act(
    'v03-invalid-action-write-string-too-long',
    { action: 'write', value: 'abcdefghi' },
    'NOTE.TEXT',
    ['E_ACTION'],
    '/events/click/value',
  );
  act('v03-valid-action-write-bool', { action: 'write', value: false }, 'PUMP01.RUN_CMD', []);
  act('v03-valid-action-toggle', { action: 'toggle' }, 'PUMP01.RUN_CMD', []);
  const dur = (n, v, valid) =>
    act(
      `v03-${valid ? 'valid' : 'invalid'}-action-pulse-duration-${n}`,
      { action: 'pulse', value: true, durationMs: v },
      'PUMP01.RUN_CMD',
      valid ? [] : ['E_ACTION'],
      '/events/click/durationMs',
    );
  dur('100', 100, true);
  dur('99', 99, false);
  dur('10000', 10000, true);
  dur('10001', 10001, false);
  dur('fraction', 100.5, false);
  act(
    'v03-invalid-action-pulse-no-duration',
    { action: 'pulse', value: true },
    'PUMP01.RUN_CMD',
    ['E_ACTION'],
    '/events/click',
  );
  act(
    'v03-invalid-action-pulse-no-value',
    { action: 'pulse', durationMs: 500 },
    'PUMP01.RUN_CMD',
    ['E_ACTION'],
    '/events/click',
  );
  act(
    'v03-invalid-action-pulse-value-number',
    { action: 'pulse', value: 1, durationMs: 500 },
    'PUMP01.RUN_CMD',
    ['E_ACTION'],
    '/events/click/value',
  );
  act(
    'v03-warn-pulse-readback',
    { action: 'pulse', value: true, durationMs: 500 },
    'PUMP02.CMD',
    [],
    undefined,
    ['W_PULSE_READBACK'],
  );
  C.at(-1)[4] = iss(e0('W_PULSE_READBACK', '/events/click'));
  act(
    'v03-valid-action-pulse-no-readback',
    { action: 'pulse', value: false, durationMs: 1000 },
    'PUMP01.RUN_CMD',
    [],
  );
  act(
    'v03-invalid-target-navigate-popup',
    { action: 'navigate', screen: 'pump' },
    null,
    ['E_ACTION_TARGET'],
    '/events/click/screen',
  );
  act(
    'v03-invalid-target-popup-screen',
    { action: 'popup', screen: 'main' },
    null,
    ['E_ACTION_TARGET'],
    '/events/click/screen',
  );
  act(
    'v03-invalid-target-navigate-missing',
    { action: 'navigate', screen: 'nope' },
    null,
    ['E_ACTION_TARGET'],
    '/events/click/screen',
  );
  act(
    'v03-invalid-target-popup-missing',
    { action: 'popup', screen: 'nope' },
    null,
    ['E_ACTION_TARGET'],
    '/events/click/screen',
  );
  act('v03-valid-target-navigate-screen', { action: 'navigate', screen: 'main' }, null, []);
  act('v03-valid-target-popup-popup', { action: 'popup', screen: 'pump' }, null, []);
  act('v03-warn-closepopup-on-screen', { action: 'closePopup' }, null, [], undefined, [
    'W_ACTION_NOOP',
  ]);
  C.at(-1)[4] = iss(e0('W_ACTION_NOOP', '/events/click'));

  // ================= Điều hướng: E_NAV =================
  const nav = (name, items, path) =>
    bad(
      name,
      (f) => (f[PJ].navigation.items = items),
      ['E_NAV'],
      undefined,
      iss(at('E_NAV', path, PJ)),
    );
  nav(
    'v03-invalid-nav-screen-missing',
    [{ label: 'X', screen: 'nope' }],
    '/navigation/items/0/screen',
  );
  nav('v03-invalid-nav-popup', [{ label: 'X', screen: 'pump' }], '/navigation/items/0/screen');
  nav(
    'v03-invalid-nav-group-in-group',
    [{ label: 'G', items: [{ label: 'H', items: [{ label: 'X', screen: 'main' }] }] }],
    '/navigation/items/0/items/0',
  );
  nav('v03-invalid-nav-group-empty', [{ label: 'G', items: [] }], '/navigation/items/0');
  nav('v03-invalid-nav-leaf-without-screen', [{ label: 'X' }], '/navigation/items/0');
  nav(
    'v03-invalid-nav-group-with-screen',
    [{ label: 'G', screen: 'main', items: [{ label: 'X', screen: 'main' }] }],
    '/navigation/items/0',
  );
  nav(
    'v03-invalid-nav-nested-popup',
    [
      {
        label: 'G',
        items: [
          { label: 'X', screen: 'main' },
          { label: 'Y', screen: 'pump' },
        ],
      },
    ],
    '/navigation/items/0/items/1/screen',
  );
  ok('v03-valid-nav-empty-items', (f) => (f[PJ].navigation.items = []));

  // ================= Cảnh báo bố cục =================
  ok(
    'v03-warn-item-outside-right',
    (f) => only(f, W('x1', 'panel', { x: 1280, y: 0 })),
    ['W_ITEM_OUTSIDE'],
    iss(e0('W_ITEM_OUTSIDE', '')),
  );
  ok(
    'v03-warn-item-outside-left',
    (f) => only(f, W('x1', 'panel', { x: -300, y: 0, width: 300 })),
    ['W_ITEM_OUTSIDE'],
    iss(e0('W_ITEM_OUTSIDE', '')),
  );
  ok(
    'v03-warn-item-outside-below',
    (f) => only(f, W('x1', 'panel', { x: 0, y: 720 })),
    ['W_ITEM_OUTSIDE'],
    iss(e0('W_ITEM_OUTSIDE', '')),
  );
  ok(
    'v03-warn-item-outside-above',
    (f) => only(f, W('x1', 'panel', { x: 0, y: -200, height: 200 })),
    ['W_ITEM_OUTSIDE'],
    iss(e0('W_ITEM_OUTSIDE', '')),
  );
  ok('v03-valid-item-partly-outside', (f) => only(f, W('x1', 'panel', { x: 1279, y: 719 })));
  ok('v03-valid-item-touching-edge', (f) =>
    only(f, W('x1', 'panel', { x: 0, y: 0, width: 1280, height: 720 })),
  );
  ok(
    'v03-warn-stretch-widgets',
    (f) => {
      f[MS].fitMode = 'stretch';
    },
    ['W_STRETCH_WIDGETS'],
    iss(at('W_STRETCH_WIDGETS', '/fitMode')),
  );
  ok('v03-valid-stretch-svg-only', (f) => {
    f[MS].fitMode = 'stretch';
    f[MS].items = f[MS].items.filter((i) => i.type === 'svg');
  });
  ok(
    'v03-warn-item-covered',
    (f) =>
      only(
        f,
        W('under', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag }),
        W('over', 'panel', { x: 90, y: 90, width: 300, height: 200 }),
      ),
    ['W_ITEM_COVERED'],
    iss(e0('W_ITEM_COVERED', '')),
  );
  ok('v03-valid-item-partly-covered', (f) =>
    only(
      f,
      W('under', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag }),
      W('over', 'panel', { x: 150, y: 90, width: 300, height: 200 }),
    ),
  );
  ok('v03-valid-item-panel-below-widget', (f) =>
    only(
      f,
      W('bg', 'panel', { x: 90, y: 90, width: 300, height: 200 }),
      W('top', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag }),
    ),
  );
  ok('v03-valid-item-covered-by-hidden', (f) =>
    only(
      f,
      W('under', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag }),
      W('over', 'panel', { x: 90, y: 90, width: 300, height: 200, hidden: true }),
    ),
  );
  ok('v03-valid-item-hidden-is-not-covered', (f) =>
    only(
      f,
      W('under', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag, hidden: true }),
      W('over', 'panel', { x: 90, y: 90, width: 300, height: 200 }),
    ),
  );
  ok(
    'v03-warn-item-covered-same-rect',
    (f) =>
      only(
        f,
        W('under', 'card', { x: 100, y: 100, width: 200, height: 100, tags: cardTag }),
        W('over', 'panel', { x: 100, y: 100, width: 200, height: 100 }),
      ),
    ['W_ITEM_COVERED'],
  );
  void cardTag;

  // ================= Popup: E_SCREEN_TAGS (cặp nhỏ) =================
  ok('v03-valid-hidden-popup-button', (f) => {
    Object.assign(
      f[MS].items.find((i) => i.id === 'btn_pump'),
      { hidden: true },
    );
  });
  return C;
}

/** Ca lớn (chỉ sinh vào out/): số Tag riêng biệt trên màn hình (1.000/1.001, kèm popup), cảnh báo > 500. */
export function large03() {
  const L = [];
  const compact = (f) => {
    for (const k of Object.keys(f))
      if (k.endsWith('.json') && typeof f[k] === 'object') f[k] = JSON.stringify(f[k]) + '\n';
  };
  /** Thêm `n` Tag với tiền tố `p`, trả về id; mỗi 50 Tag một `tag-table` ở màn hình `file` (item hidden: tùy chọn). */
  const tables = (f, file, p, n, hiddenFrom = Infinity) => {
    const ids = nTags(f, n, p);
    const out = [];
    for (let i = 0; i < n; i += 50) {
      const k = out.length;
      out.push(
        W(`${p.toLowerCase()}${pad(k + 1, 2)}`, 'tag-table', {
          x: k * 2,
          y: 0,
          width: 300,
          height: 200,
          tags: { rows: ids.slice(i, i + 50) },
          ...(k >= hiddenFrom ? { hidden: true } : {}),
        }),
      );
    }
    f[file].items.push(...out);
  };
  const isolate = (f) => {
    f[MS].items = [];
    f[PS].items = [];
  };
  const single = (n, hiddenFrom) => (f) => {
    isolate(f);
    tables(f, MS, 'A', n, hiddenFrom);
    compact(f);
  };
  // n Tag của main + 400 của popup, nút mở popup trong main
  const pair = (n) => (f) => {
    isolate(f);
    tables(f, MS, 'A', n);
    tables(f, PS, 'B', 400);
    f[MS].items.push(
      W('open', 'button', {
        x: 900,
        y: 600,
        width: 160,
        height: 48,
        events: { click: { action: 'popup', screen: 'pump' } },
      }),
    );
    compact(f);
  };
  const manyWarn = ['W_SCREEN_TAGS_MANY'];
  const withEmpty = ['W_SCREEN_EMPTY', 'W_SCREEN_TAGS_MANY']; // popup rỗng ở ca một màn hình
  L.push(['v03-large-valid-tags-500', single(500), [], ['W_SCREEN_EMPTY']]);
  L.push([
    'v03-large-warn-tags-501',
    single(501),
    [],
    withEmpty,
    { issues: [at('W_SCREEN_TAGS_MANY', '/items')] },
  ]);
  L.push(['v03-large-warn-tags-1000', single(1000), [], withEmpty]);
  L.push([
    'v03-large-invalid-tags-1001',
    single(1001),
    ['E_SCREEN_TAGS'],
    withEmpty,
    { issues: [at('E_SCREEN_TAGS', '/items')] },
  ]);
  // 21 bảng (1.050 Tag) trong đó 1 bảng 50 Tag ẩn (item hidden): chỉ tính 1.000 Tag
  L.push(['v03-large-valid-tags-hidden-excluded', single(1050, 20), [], withEmpty]);
  L.push(['v03-large-valid-pair-1000', pair(600), [], manyWarn]);
  L.push([
    'v03-large-invalid-pair-1001',
    pair(601),
    ['E_SCREEN_TAGS'],
    manyWarn,
    { issues: [at('E_SCREEN_TAGS', '/items')] },
  ]);
  // nút ẩn không mở popup: 601 + 400 không bị tính
  L.push([
    'v03-large-valid-pair-hidden-button',
    (f) => {
      pair(601)(f);
      const m = JSON.parse(f[MS]);
      m.items.find((i) => i.id === 'open').hidden = true;
      f[MS] = JSON.stringify(m) + '\n';
    },
    [],
    manyWarn,
  ]);
  return L;
}
