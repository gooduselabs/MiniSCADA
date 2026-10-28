// Ca `v11-*` của bộ vector project (feature 012, T008; specs/012-screen-grid-layout/contracts/project-format-1.1.md §3,
// §5). Được generate.mjs nạp; mô tả ở tests/project-vectors/README-012.md. Dùng chung TS (vectors-11.test.ts) và C++
// (core/project-manager/tests/vectors_11_test.cpp, T011).
//
// Mỗi ca: [tên, hàm sửa base11, mã lỗi (tập), cảnh báo (tập), thêm { issues, runtimeVersion }]. `runtimeVersion` mặc định
// 1.1.0 trong expected.json (bộ chạy truyền cho validator).
import { base10 } from './v10.mjs';
import { finsCases } from './v11-fins.mjs';
import { mcCases } from './v11-mc.mjs';
import { bacnetCases } from './v11-bacnet.mjs';
import { opcuaCases } from './v11-opcua.mjs';
import { navCases } from './v11-nav.mjs';
import { recipeCases } from './v11-recipes.mjs';
import { mqttCases } from './v11-mqtt.mjs';
import { reportCases } from './v11-reports.mjs';
import { s7Cases } from './v11-s7.mjs';

export const V11 = '1.1.0';
export const RUNTIME_11 = '1.1.0';
const PJ = 'project.json';
const GS = 'screens/tong-quan.screen.json';
const MS = 'screens/main.screen.json';
const FS = 'screens/bom-chi-tiet.screen.json';

/** Màn hình lưới `tong-quan` (contract §2): hàng 4+4+4, hàng 8+4 (ô cuối trống), hàng 12 cao 320 px. */
export const gridScreen = () => ({
  schemaVersion: V11,
  id: 'tong-quan',
  name: 'Tổng quan',
  size: { width: 1920, height: 1080 },
  layout: {
    mode: 'grid',
    columns: 12,
    gap: 12,
    padding: 16,
    rows: [
      {
        id: 'r1',
        height: 'auto',
        cells: [
          { id: 'c1', span: 4, item: 'luu_luong' },
          { id: 'c2', span: 4, item: 'dong_ho' },
          { id: 'c3', span: 4, item: 'den' },
        ],
      },
      {
        id: 'r2',
        height: 'auto',
        cells: [
          { id: 'c4', span: 8, item: 'xu_huong' },
          { id: 'c5', span: 4 },
        ],
      },
      { id: 'r3', height: 320, cells: [{ id: 'c6', span: 12, item: 'khung' }] },
    ],
  },
  items: [
    {
      id: 'luu_luong',
      type: 'widget',
      widget: 'card',
      props: { label: 'Lưu lượng bơm 7' },
      tags: { value: 'PUMP07.FLOW' },
    },
    { id: 'dong_ho', type: 'widget', widget: 'gauge', tags: { value: 'PUMP08.FLOW' } },
    { id: 'den', type: 'widget', widget: 'lamp', tags: { state: 'PUMP07.RUN' } },
    { id: 'xu_huong', type: 'widget', widget: 'line', tags: { series: ['PUMP07.FLOW'] } },
    { id: 'khung', type: 'widget', widget: 'panel' },
  ],
});

export function base11() {
  const f = base10();
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined) v.schemaVersion = V11;
  f[PJ].projectId = 'vector11';
  f[PJ].projectName = 'Vector 1.1';
  f[PJ].minRuntimeVersion = RUNTIME_11;
  f[PJ].theme = 'vivid';
  f[PJ].screens.push('tong-quan');
  f[GS] = gridScreen();
  return f;
}

const at = (code, path, file = GS) => ({ code, file, path });
const iss = (...issues) => ({ issues });
const g = (f) => f[GS];
const row = (f, r) => g(f).layout.rows[r];
const cell = (f, r, c) => row(f, r).cells[c];

export function cases11() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) => C.push([name, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([name, mutate, errors, warnings, extra]);

  // ================= hợp lệ =================
  ok('v11-valid-full', () => {});
  ok('v11-valid-no-layout', (f) => {
    // 1.1 không bắt buộc dùng lưới: mọi màn hình tự do, không theme
    delete f[PJ].theme;
    f[PJ].screens = f[PJ].screens.filter((s) => s !== 'tong-quan');
    delete f[GS];
  });
  ok('v11-valid-theme-industrial', (f) => (f[PJ].theme = 'industrial'));
  ok('v11-valid-theme-dark', (f) => (f[PJ].theme = 'dark'));
  ok('v11-valid-offset-align', (f) => {
    row(f, 1).cells = [
      { id: 'c4', span: 6, offset: 2, align: 'center', minHeight: 200, item: 'xu_huong' },
      { id: 'c5', span: 4 },
    ];
  });
  ok(
    'v11-valid-span-sum-less-than-12',
    (f) => (row(f, 1).cells = [{ id: 'c4', span: 8, item: 'xu_huong' }]),
  );
  ok(
    'v11-valid-empty-rows',
    (f) => {
      g(f).layout.rows = [];
      g(f).items = [];
    },
    ['W_SCREEN_EMPTY'],
  );
  ok('v11-valid-row-height-bounds', (f) => {
    row(f, 2).height = 24;
    row(f, 0).height = 4000;
  });
  ok('v11-valid-popup-grid', (f) => {
    const p = f[FS];
    const items = p.items.map((it) => {
      const out = { ...it };
      for (const k of ['x', 'y', 'width', 'height']) delete out[k];
      return out;
    });
    p.items = items;
    p.layout = {
      mode: 'grid',
      columns: 12,
      rows: [
        {
          id: 'r1',
          height: 'auto',
          cells: items.map((it, i) => ({ id: `c${i + 1}`, span: 3, item: it.id })),
        },
      ],
    };
  });
  ok('v11-valid-12-cells', (f) => {
    row(f, 1).cells = Array.from({ length: 12 }, (_, i) => ({
      id: `k${i}`,
      span: 1,
      ...(i === 0 ? { item: 'xu_huong' } : {}),
    }));
  });
  ok('v11-valid-100-rows', (f) => {
    const rows = g(f).layout.rows;
    for (let i = rows.length; i < 100; i++)
      rows.push({ id: `x${i}`, height: 'auto', cells: [{ id: `y${i}`, span: 12 }] });
  });
  ok('v11-valid-ids-dash-underscore', (f) => {
    row(f, 0).id = 'hang-1_a';
    cell(f, 0, 0).id = 'o-1_a';
  });

  // ================= E_LAYOUT_COLUMNS =================
  bad(
    'v11-columns-6',
    (f) => (g(f).layout.columns = 6),
    ['E_LAYOUT_COLUMNS'],
    undefined,
    iss(at('E_LAYOUT_COLUMNS', '/layout/columns')),
  );
  bad('v11-columns-24', (f) => (g(f).layout.columns = 24), ['E_LAYOUT_COLUMNS']);
  bad(
    'v11-mode-flex',
    (f) => (g(f).layout.mode = 'flex'),
    ['E_LAYOUT_COLUMNS'],
    undefined,
    iss(at('E_LAYOUT_COLUMNS', '/layout/mode')),
  );

  // ================= E_LAYOUT_SPAN =================
  bad('v11-span-0', (f) => (cell(f, 0, 0).span = 0), ['E_SCHEMA']);
  bad(
    'v11-span-sum-13',
    (f) => (cell(f, 0, 2).span = 5),
    ['E_LAYOUT_SPAN'],
    undefined,
    iss(at('E_LAYOUT_SPAN', '/layout/rows/0/cells/2/span')),
  );
  bad(
    'v11-span-offset-overflow',
    (f) => (cell(f, 1, 0).offset = 5),
    ['E_LAYOUT_SPAN'],
    undefined,
    iss(at('E_LAYOUT_SPAN', '/layout/rows/1/cells/0/span')),
  );
  bad(
    'v11-span-single-12-offset-1',
    (f) => {
      cell(f, 2, 0).offset = 1;
    },
    ['E_LAYOUT_SPAN'],
    undefined,
    iss(at('E_LAYOUT_SPAN', '/layout/rows/2/cells/0/span')),
  );

  // ================= E_LAYOUT_ID =================
  bad(
    'v11-id-dup-cell',
    (f) => (cell(f, 0, 1).id = 'c1'),
    ['E_LAYOUT_ID'],
    undefined,
    iss(at('E_LAYOUT_ID', '/layout/rows/0/cells/1/id')),
  );
  bad(
    'v11-id-dup-row-cell',
    (f) => (row(f, 1).id = 'c1'),
    ['E_LAYOUT_ID'],
    undefined,
    iss(at('E_LAYOUT_ID', '/layout/rows/1/id')),
  );
  bad('v11-id-pattern', (f) => (row(f, 0).id = 'Hang1'), ['E_SCHEMA']);

  // ================= E_LAYOUT_ITEM_REF =================
  bad(
    'v11-item-ref-missing',
    (f) => (cell(f, 1, 1).item = 'khong_co'),
    ['E_LAYOUT_ITEM_REF'],
    undefined,
    iss(at('E_LAYOUT_ITEM_REF', '/layout/rows/1/cells/1/item')),
  );
  bad('v11-item-ref-other-screen', (f) => (cell(f, 1, 1).item = 'pump7.lamp'), [
    'E_LAYOUT_ITEM_REF',
  ]);

  // ================= E_LAYOUT_ITEM_DUP =================
  bad(
    'v11-item-dup',
    (f) => (cell(f, 1, 1).item = 'den'),
    ['E_LAYOUT_ITEM_DUP'],
    undefined,
    iss(at('E_LAYOUT_ITEM_DUP', '/layout/rows/1/cells/1/item')),
  );
  bad(
    'v11-item-dup-three',
    (f) => {
      cell(f, 1, 1).item = 'den';
      cell(f, 2, 0).item = 'den';
    },
    ['E_LAYOUT_ITEM_DUP'],
    ['W_LAYOUT_ITEM_ORPHAN'],
    iss(at('E_LAYOUT_ITEM_DUP', '/layout/rows/2/cells/0/item')),
  );

  // ================= E_LAYOUT_ITEM_POS =================
  bad(
    'v11-item-pos-in-grid',
    (f) => Object.assign(g(f).items[0], { x: 0, y: 0, width: 200, height: 80 }),
    ['E_LAYOUT_ITEM_POS'],
    undefined,
    iss(at('E_LAYOUT_ITEM_POS', '/items/0/x')),
  );
  bad(
    'v11-item-pos-height-only',
    (f) => (g(f).items[2].height = 40),
    ['E_LAYOUT_ITEM_POS'],
    undefined,
    iss(at('E_LAYOUT_ITEM_POS', '/items/2/height')),
  );
  bad(
    'v11-free-item-missing-pos',
    (f) => delete f[MS].items[0].width,
    ['E_LAYOUT_ITEM_POS'],
    undefined,
    iss(at('E_LAYOUT_ITEM_POS', '/items/0/width', MS)),
  );
  bad(
    'v11-free-item-missing-all',
    (f) => {
      const it = f[MS].items[0];
      delete it.x;
      delete it.y;
      delete it.width;
      delete it.height;
    },
    ['E_LAYOUT_ITEM_POS'],
    undefined,
    iss(at('E_LAYOUT_ITEM_POS', '/items/0/x', MS)),
  );

  // ================= E_LAYOUT_LIMIT =================
  bad(
    'v11-limit-101-rows',
    (f) => {
      const rows = g(f).layout.rows;
      for (let i = rows.length; i < 101; i++)
        rows.push({ id: `x${i}`, height: 'auto', cells: [{ id: `y${i}`, span: 12 }] });
    },
    ['E_LAYOUT_LIMIT'],
    undefined,
    iss(at('E_LAYOUT_LIMIT', '/layout/rows')),
  );
  bad(
    'v11-limit-13-cells',
    (f) => {
      row(f, 1).cells = Array.from({ length: 13 }, (_, i) => ({
        id: `k${i}`,
        span: 1,
        ...(i === 0 ? { item: 'xu_huong' } : {}),
      }));
    },
    ['E_LAYOUT_LIMIT', 'E_LAYOUT_SPAN'],
    undefined,
    iss(at('E_LAYOUT_LIMIT', '/layout/rows/1/cells')),
  );
  bad(
    'v11-limit-row-no-cells',
    (f) => {
      row(f, 1).cells = [];
    },
    ['E_LAYOUT_LIMIT'],
    ['W_LAYOUT_ITEM_ORPHAN'],
    iss(at('E_LAYOUT_LIMIT', '/layout/rows/1/cells')),
  );

  // ================= W_LAYOUT_ITEM_ORPHAN =================
  ok(
    'v11-orphan-item',
    (f) => delete cell(f, 0, 2).item,
    ['W_LAYOUT_ITEM_ORPHAN'],
    iss(at('W_LAYOUT_ITEM_ORPHAN', '/items/2')),
  );
  ok('v11-orphan-all', (f) => (g(f).layout.rows = []), ['W_LAYOUT_ITEM_ORPHAN']);

  // ================= E_LAYOUT_VERSION =================
  bad(
    'v11-version-layout-in-1.0',
    (f) => {
      for (const v of Object.values(f))
        if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
          v.schemaVersion = '1.0.0';
      f[PJ].minRuntimeVersion = '1.0.0';
      delete f[PJ].theme;
    },
    ['E_LAYOUT_VERSION'],
    undefined,
    iss(at('E_LAYOUT_VERSION', '/layout')),
  );
  bad(
    'v11-version-theme-in-1.0',
    (f) => {
      for (const v of Object.values(f))
        if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
          v.schemaVersion = '1.0.0';
      f[PJ].minRuntimeVersion = '1.0.0';
      f[PJ].screens = f[PJ].screens.filter((s) => s !== 'tong-quan');
      delete f[GS];
    },
    ['E_LAYOUT_VERSION'],
    undefined,
    iss(at('E_LAYOUT_VERSION', '/theme', PJ)),
  );
  bad(
    'v11-version-min-runtime-1.0',
    (f) => (f[PJ].minRuntimeVersion = '1.0.0'),
    ['E_LAYOUT_VERSION'],
    undefined,
    iss(at('E_LAYOUT_VERSION', '/minRuntimeVersion', PJ)),
  );
  bad('v11-runtime-too-old', () => {}, ['E_RUNTIME_TOO_OLD'], undefined, {
    runtimeVersion: '1.0.0',
  });

  // ================= schema, phiên bản =================
  bad('v11-theme-unknown', (f) => (f[PJ].theme = 'neon'), ['E_SCHEMA']);
  bad('v11-schema-version-mixed', (f) => (g(f).schemaVersion = '1.0.0'), ['E_SCHEMA_VERSION']);
  // 1.2 bị từ chối: ca v02-invalid-schema-version-1.2 (project 1.2 rơi về bộ schema 0.1 như mọi phiên bản lạ)
  bad('v11-layout-unknown-key', (f) => (g(f).layout.extra = 1), ['E_SCHEMA']);
  bad('v11-cell-unknown-key', (f) => (cell(f, 0, 0).width = 4), ['E_SCHEMA']);
  bad('v11-row-height-too-small', (f) => (row(f, 2).height = 10), ['E_SCHEMA']);
  bad('v11-gap-too-big', (f) => (g(f).layout.gap = 65), ['E_SCHEMA']);

  // ================= luật cũ vẫn chạy trên màn hình lưới =================
  bad('v11-grid-widget-tag-missing', (f) => (g(f).items[0].tags.value = 'KHONG.CO'), ['E_REF_TAG']);
  bad('v11-grid-item-id-dup', (f) => (g(f).items[1].id = 'luu_luong'), [
    'E_ITEM_ID',
    'E_LAYOUT_ITEM_REF',
  ]);

  securityCases(ok, bad);
  reportCases(ok, bad, to10); // feature 015 (README-015.md)
  s7Cases(ok, bad, to10, base11); // feature 016 (README-016.md)
  finsCases(ok, bad, to10); // feature 018 (README-018.md)
  mcCases(ok, bad, to10); // feature 017 (README-017.md)
  bacnetCases(ok, bad, to10); // feature 020 (README-020.md)
  opcuaCases(ok, bad, to10, base11); // feature 019 (README-019.md)
  recipeCases(ok, bad, to10); // feature 024 (README-024.md)
  mqttCases(ok, bad, to10, base11); // feature 022 (README-022.md)
  navCases(ok, bad, to10); // feature 030 (README-030.md)
  return C;
}

// ================= feature 013: security.view / security.operate (README-013.md) =================
const MB = 'screens/main.bindings.json';
/** Chỉ số item của main (base03 + base10): 0 svg1 (sự kiện popup, không ghi), 2 card_level, 5 sp_level (setpoint,
 * minRole engineer), 6 btn_run (button). */
const main = (f, i) => f[MS].items[i];
const sec = (f, i, s) => (main(f, i).security = s);
/** Hạ mọi tệp về 1.0 và bỏ phần chỉ có ở 1.1 (màn hình lưới, theme), như ca v11-version-theme-in-1.0. */
const to10 = (f) => {
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined)
      v.schemaVersion = '1.0.0';
  f[PJ].minRuntimeVersion = '1.0.0';
  delete f[PJ].theme;
  f[PJ].screens = f[PJ].screens.filter((s) => s !== 'tong-quan');
  delete f[GS];
};

function securityCases(ok, bad) {
  // ---------- hợp lệ ----------
  ok('v11-security-valid-view-operate', (f) => {
    sec(f, 6, { view: 'operator', operate: 'engineer' });
    sec(f, 2, { view: 'engineer' });
    f[MS].security = { view: 'viewer' };
    g(f).security = { view: 'operator' };
    f[FS].security = { view: 'operator' };
  });
  ok('v11-security-valid-svg-write-operate', (f) => {
    const el = f[MB].elements.find((e) => e.elementUid === 'el_bbb');
    el.events = { click: { action: 'toggle', tag: 'PUMP01.RUN_CMD' } };
    sec(f, 0, { view: 'operator', operate: 'engineer' });
  });
  ok('v11-security-valid-svg-view-only', (f) => sec(f, 0, { view: 'engineer' }));
  ok('v11-security-valid-minrole-equals-operate', (f) =>
    sec(f, 5, { minRole: 'engineer', operate: 'engineer' }),
  );
  ok('v11-security-valid-view-higher-than-default-operate', (f) =>
    sec(f, 6, { view: 'administrator' }),
  );
  ok('v11-security-valid-grid-item', (f) => (g(f).items[0].security = { view: 'operator' }));
  ok('v11-security-valid-popup-switch', (f) => {
    f[FS].security = { view: 'engineer' };
    f[FS].items.find((it) => it.widget === 'switch').security = {
      view: 'engineer',
      operate: 'administrator',
    };
  });

  // ---------- E_SECURITY_LEVEL ----------
  bad(
    'v11-security-level-operate-viewer',
    (f) => sec(f, 6, { operate: 'viewer' }),
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/items/6/security/operate', MS)),
  );
  bad(
    'v11-security-level-operate-below-view',
    (f) => sec(f, 6, { view: 'engineer', operate: 'operator' }),
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/items/6/security/operate', MS)),
  );
  bad(
    'v11-security-level-minrole-differs',
    (f) => sec(f, 5, { minRole: 'engineer', operate: 'administrator' }),
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/items/5/security/minRole', MS)),
  );
  bad(
    'v11-security-level-item-view-in-1.0',
    (f) => {
      to10(f);
      sec(f, 2, { view: 'operator' });
    },
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/items/2/security/view', MS)),
  );
  bad(
    'v11-security-level-item-operate-in-1.0',
    (f) => {
      to10(f);
      sec(f, 6, { operate: 'engineer' });
    },
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/items/6/security/operate', MS)),
  );
  bad(
    'v11-security-level-screen-in-1.0',
    (f) => {
      to10(f);
      f[MS].security = { view: 'operator' };
    },
    ['E_SECURITY_LEVEL'],
    undefined,
    iss(at('E_SECURITY_LEVEL', '/security', MS)),
  );
  // 1.0 giữ nguyên hành vi: minRole của nút vẫn hợp lệ
  ok('v11-security-valid-minrole-in-1.0', (f) => {
    to10(f);
    sec(f, 6, { minRole: 'engineer' });
  });

  // ---------- E_SECURITY_ITEM ----------
  bad(
    'v11-security-item-display-widget',
    (f) => sec(f, 2, { operate: 'operator' }),
    ['E_SECURITY_ITEM'],
    undefined,
    iss(at('E_SECURITY_ITEM', '/items/2/security/operate', MS)),
  );
  bad(
    'v11-security-item-svg-without-write',
    (f) => sec(f, 0, { operate: 'operator' }),
    ['E_SECURITY_ITEM'],
    undefined,
    iss(at('E_SECURITY_ITEM', '/items/0/security/operate', MS)),
  );
  bad(
    'v11-security-item-grid-gauge',
    (f) => (g(f).items[1].security = { view: 'viewer', operate: 'engineer' }),
    ['E_SECURITY_ITEM'],
    undefined,
    iss(at('E_SECURITY_ITEM', '/items/1/security/operate')),
  );

  // ---------- schema, luật cũ ----------
  bad('v11-security-view-unknown-role', (f) => sec(f, 2, { view: 'boss' }), ['E_SCHEMA']);
  bad('v11-security-operate-unknown-role', (f) => sec(f, 6, { operate: 'root' }), ['E_SCHEMA']);
  bad('v11-security-unknown-key', (f) => sec(f, 6, { maxRole: 'engineer' }), ['E_SCHEMA']);
  bad('v11-security-screen-operate-key', (f) => (f[MS].security = { operate: 'operator' }), [
    'E_SCHEMA',
  ]);
  bad('v11-security-screen-view-unknown', (f) => (f[MS].security = { view: 'root' }), ['E_SCHEMA']);
  bad(
    'v11-security-display-minrole-still-prop',
    (f) => sec(f, 2, { minRole: 'operator' }),
    ['E_WIDGET_PROP'],
    undefined,
    iss(at('E_WIDGET_PROP', '/items/2/security', MS)),
  );
}
