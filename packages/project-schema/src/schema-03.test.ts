// Schema 0.3.0 (T010; contracts/project-format-0.3.md §2-§5): ví dụ của contract hợp lệ, khóa 0.2 ở cấp màn hình
// bị từ chối, binding có `itemId` tùy chọn. Schema chỉ kiểm khung; luật chi tiết ở rules-03 (vectors-03.test.ts).
// Biến môi trường MAT_SCHEMA_DIR (mặc định `schemas/0.3`: bản đóng băng từ feature 008) để kiểm bước đỏ trên bản schema cũ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SDIR = process.env.MAT_SCHEMA_DIR ?? 'schemas/0.3';
const load = (f: string) => JSON.parse(readFileSync(resolve(ROOT, SDIR, f), 'utf8')) as Schema;
const make = (f: string) => new Validator(load(f), '7', false);
const project = make('project.schema.json');
const screen = make('screen.schema.json');
const binding = make('binding.schema.json');

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project
const ok = (v: Validator, doc: unknown) => {
  const r = v.validate(doc);
  expect(r.errors.map((e) => `${e.instanceLocation}: ${e.error}`)).toEqual([]);
};
const bad = (v: Validator, doc: unknown) => expect(v.validate(doc).valid).toBe(false);

const projectDoc = (): Json => ({
  format: 'matscada-project',
  schemaVersion: '0.3.0',
  projectId: 'pump-station',
  projectName: 'Trạm bơm số 1',
  projectVersion: '1.2.0',
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
      {
        label: 'Giám sát',
        icon: 'chart',
        items: [{ label: 'Xu hướng', screen: 'giam-sat', icon: 'chart' }],
      },
    ],
  },
  maxClients: 10,
});

const screenDoc = (): Json => ({
  schemaVersion: '0.3.0',
  id: 'tong-quan',
  name: 'Tổng quan',
  kind: 'screen',
  size: { width: 1920, height: 1080 },
  fitMode: 'contain',
  background: '#0F172A',
  items: [
    {
      id: 'svg1',
      name: 'Sơ đồ bồn và bơm',
      type: 'svg',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      svgFile: 'screens/tong-quan.svg',
      bindingFile: 'screens/tong-quan.bindings.json',
      viewBox: [0, 0, 1920, 1080],
      fit: 'contain',
      elements: [{ elementUid: 'el_tank' }, { elementUid: 'el_pump' }],
    },
    {
      id: 'panel_1',
      name: 'Khung bồn',
      type: 'widget',
      widget: 'panel',
      x: 40,
      y: 40,
      width: 520,
      height: 360,
      props: { title: 'Bồn nước 1' },
    },
    {
      id: 'card_level',
      name: 'Mức bồn',
      type: 'widget',
      widget: 'card',
      x: 60,
      y: 100,
      width: 220,
      height: 110,
      props: { label: 'Mức nước', decimals: 1 },
      tags: { value: 'TANK01.LEVEL' },
    },
    {
      id: 'sp_level',
      name: 'Đặt mức',
      type: 'widget',
      widget: 'setpoint',
      x: 300,
      y: 100,
      width: 240,
      height: 72,
      props: { label: 'Mức đặt' },
      tags: { target: 'TANK01.SP' },
      security: { minRole: 'operator' },
    },
    {
      id: 'btn_start',
      name: 'Bật bơm',
      type: 'widget',
      widget: 'button',
      x: 60,
      y: 260,
      width: 160,
      height: 48,
      props: { label: 'Bật bơm 1' },
      tags: { target: 'PUMP01.RUN_CMD' },
      events: { click: { action: 'pulse', value: true, durationMs: 500 } },
    },
    {
      id: 'btn_pump',
      name: 'Chi tiết bơm',
      type: 'widget',
      widget: 'button',
      x: 240,
      y: 260,
      width: 160,
      height: 48,
      props: { label: 'Chi tiết bơm 1', variant: 'neutral' },
      events: { click: { action: 'popup', screen: 'bom1' } },
    },
    {
      id: 'trend',
      type: 'widget',
      widget: 'line',
      x: 0,
      y: 400,
      width: 600,
      height: 300,
      tags: { series: ['TANK01.LEVEL', 'TANK01.SP'] },
    },
  ],
});

describe('schemas/project.schema.json 0.3', () => {
  it('ví dụ của contract §2 hợp lệ', () => ok(project, projectDoc()));
  it('navigation tùy chọn', () => {
    const p = projectDoc();
    delete p.navigation;
    ok(project, p);
  });
  it('navigation: vị trí, icon, nhãn, khóa lạ bị từ chối', () => {
    for (const mut of [
      (p: Json) => (p.navigation.position = 'right'),
      (p: Json) => (p.navigation.items[0].icon = 'rocket'),
      (p: Json) => (p.navigation.items[0].label = ''),
      (p: Json) => (p.navigation.items[0].label = 'x'.repeat(41)),
      (p: Json) => (p.navigation.badge = 1),
      (p: Json) => delete p.navigation.items,
      (p: Json) => (p.navigation = []),
    ]) {
      const p = projectDoc();
      mut(p);
      bad(project, p);
    }
  });
  it('đủ 16 icon', () => {
    const icons =
      'home tank pump chart table gear bell bolt thermo drop valve motor list map doc user'.split(
        ' ',
      );
    const p = projectDoc();
    p.navigation.items = icons.map((icon) => ({ label: icon, screen: 'tong-quan', icon }));
    ok(project, p);
  });
  it('số màn hình và mục menu vượt giới hạn do luật E_LIMIT kiểm, không phải schema', () => {
    const p = projectDoc();
    p.screens = Array.from({ length: 33 }, (_, i) => `s${i}`);
    ok(project, p);
    p.navigation.items = Array.from({ length: 33 }, (_, i) => ({
      label: `m${i}`,
      screen: 'tong-quan',
    }));
    ok(project, p);
  });
});

describe('schemas/screen.schema.json 0.3', () => {
  it('ví dụ của contract §3 hợp lệ', () => ok(screen, screenDoc()));
  it('popup, không kind, không fitMode, không background', () => {
    const s = screenDoc();
    s.kind = 'popup';
    delete s.fitMode;
    delete s.background;
    ok(screen, s);
    delete s.kind;
    ok(screen, s);
  });
  it('khóa 0.2 ở cấp màn hình bị từ chối', () => {
    for (const [k, v] of [
      ['svgFile', 'screens/x.svg'],
      ['bindingFile', 'screens/x.bindings.json'],
      ['viewBox', [0, 0, 10, 10]],
      ['elements', []],
    ] as const) {
      const s = screenDoc();
      s[k] = v;
      bad(screen, s);
    }
  });
  it('thiếu size hoặc items bị từ chối', () => {
    for (const k of ['size', 'items', 'name', 'id']) {
      const s = screenDoc();
      delete s[k];
      bad(screen, s);
    }
  });
  it('size, fitMode, background', () => {
    for (const mut of [
      (s: Json) => (s.size.width = 100.5),
      (s: Json) => (s.size = { width: 100 }),
      (s: Json) => (s.fitMode = 'zoom'),
      (s: Json) => (s.background = 'red'),
      (s: Json) => (s.name = ''),
    ]) {
      const s = screenDoc();
      mut(s);
      bad(screen, s);
    }
  });
  it('size ngoài khoảng, id sai dạng, kind lạ, 251 item do luật kiểm, không phải schema', () => {
    const s = screenDoc();
    s.size = { width: 63, height: 5000 };
    s.id = 'Tong_Quan';
    s.kind = 'dialog';
    s.items = Array.from({ length: 251 }, (_, i) => ({
      id: `p${i}`,
      type: 'widget',
      widget: 'panel',
      x: 0,
      y: 0,
      width: 0,
      height: -3,
    }));
    ok(screen, s);
  });
  it('item: oneOf svg / widget, khóa lạ, kiểu lạ', () => {
    for (const mut of [
      (s: Json) => (s.items[1].angle = 90),
      (s: Json) => (s.items[1].type = 'group'),
      (s: Json) => delete s.items[1].widget,
      (s: Json) => (s.items[1].svgFile = 'screens/x.svg'),
      (s: Json) => (s.items[0].props = {}),
      (s: Json) => delete s.items[0].bindingFile,
      (s: Json) => (s.items[0].viewBox = [0, 0, 0, 10]),
      (s: Json) => (s.items[0].fit = 'fit-width'),
      (s: Json) => (s.items[1].x = 8193),
      (s: Json) => (s.items[1].x = -2049),
      (s: Json) => (s.items[1].width = 8193),
      (s: Json) => (s.items[1].height = 1.5),
      (s: Json) => (s.items[1].props = []),
      (s: Json) => (s.items[2].tags.value = 5),
      (s: Json) => (s.items[3].security.maxRole = 'x'),
      (s: Json) => (s.items[4].events.hover = {}),
      (s: Json) => (s.items[4].events.click = 'pulse'),
    ]) {
      const s = screenDoc();
      mut(s);
      bad(screen, s);
    }
  });
  it('item: tags nhiều Tag là mảng chuỗi, widget lạ qua được schema (luật E_WIDGET_UNKNOWN)', () => {
    const s = screenDoc();
    s.items[6].tags.series = ['A', 'B'];
    s.items[1].widget = 'gizmo';
    s.items[1].id = 'Bad-Id';
    s.items[1].width = 0;
    ok(screen, s);
  });
  it('toàn bộ khóa hợp lệ của item svg và widget', () => {
    const s = screenDoc();
    Object.assign(s.items[0], { locked: true, hidden: false });
    Object.assign(s.items[2], { locked: false, hidden: true });
    ok(screen, s);
  });
});

describe('schemas/binding.schema.json 0.3', () => {
  const doc = (): Json => ({
    schemaVersion: '0.3.0',
    screenId: 'tong-quan',
    itemId: 'svg1',
    elements: [
      {
        elementUid: 'el_tank',
        bindings: [
          {
            id: 'b1',
            target: 'geometry.levelPercent',
            source: { type: 'tag', tagId: 'TANK01.LEVEL' },
            transform: { kind: 'direct' },
          },
        ],
      },
    ],
  });
  it('có và không có itemId đều hợp lệ', () => {
    ok(binding, doc());
    const b = doc();
    delete b.itemId;
    ok(binding, b);
  });
  it('itemId sai dạng bị từ chối', () => {
    for (const v of ['SVG 1', 'a', '1x', 5]) {
      const b = doc();
      b.itemId = v;
      bad(binding, b);
    }
  });
});

describe('mọi file khác nhận 0.3.x', () => {
  it('$id của 8 schema theo phiên bản 0.3', () => {
    for (const f of [
      'project',
      'tag',
      'screen',
      'binding',
      'logging',
      'connections',
      'value-table',
      'watch-table',
    ])
      expect((load(`${f}.schema.json`) as { $id: string }).$id, f).toMatch(
        new RegExp(`/${f}/0\\.3\\.json$`),
      );
  });
});
