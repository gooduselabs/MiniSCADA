// Chuyển màn hình bố cục tự do sang lưới (feature 012, T051; US5, FR-040, SC-010): `convertToGrid(doc)` là hàm thuần,
// gom item theo dải `y` chồng lấn thành hàng, sắp theo `x` trong hàng, đổi chiều rộng và khoảng trống bên trái thành
// `span` / `offset` trên 12 cột; giữ mọi item và binding, chỉ bỏ `x`, `y`, `width`, `height`. Kết quả qua `validateProject`.
import { resolve } from 'node:path';
import {
  formatScreen03,
  GRID_COLUMNS,
  MemorySource,
  migrateTo11,
  validateProject,
  type GridLayout,
  type ScreenModel,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { convertToGrid, type ConvertReport } from './grid-convert.ts';
import { DASHBOARD_DEMO, readProjectDir, REPO, tankDemo } from './test-fixtures.ts';

type G = ScreenModel & { layout: GridLayout };
type Box = { id: string; x: number; y: number; w: number; h: number; hidden?: boolean };

const POS = ['x', 'y', 'width', 'height'] as const;

const free = (boxes: readonly Box[], width = 1200, height = 800): ScreenModel =>
  ({
    schemaVersion: '1.1.0',
    id: 'cu',
    name: 'Màn hình cũ',
    kind: 'screen',
    size: { width, height },
    items: boxes.map((b) => ({
      id: b.id,
      type: 'widget',
      widget: 'card',
      x: b.x,
      y: b.y,
      width: b.w,
      height: b.h,
      ...(b.hidden ? { hidden: true } : {}),
      props: { label: b.id },
      tags: { value: `T.${b.id}` },
    })),
  }) as unknown as ScreenModel;

const L = (d: ScreenModel) => (d as G).layout;
/** Mỗi hàng: danh sách `[offset, span, item]`. */
const shape = (d: ScreenModel) =>
  L(d).rows.map((r) => r.cells.map((c) => [c.offset ?? 0, c.span, c.item ?? null]));
const spans = (d: ScreenModel) => L(d).rows.map((r) => r.cells.map((c) => c.span));
const rowSum = (r: GridLayout['rows'][number]) =>
  r.cells.reduce((n, c) => n + (c.offset ?? 0) + c.span, 0);
const without = (o: object) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !(POS as readonly string[]).includes(k)));

/** Bất biến chung của mọi kết quả: 12 cột, tổng hàng ≤ 12, ô ≥ 1 cột, mỗi item đúng một ô, item không còn tọa độ. */
function expectInvariants(before: ScreenModel, after: ScreenModel, report: ConvertReport): void {
  const l = L(after);
  expect(l.mode).toBe('grid');
  expect(l.columns).toBe(GRID_COLUMNS);
  const ids = new Set<string>();
  for (const r of l.rows) {
    expect(r.cells.length).toBeGreaterThan(0);
    expect(r.cells.length).toBeLessThanOrEqual(12);
    expect(rowSum(r)).toBeLessThanOrEqual(12);
    for (const c of r.cells) {
      expect(Number.isInteger(c.span) && c.span >= 1).toBe(true);
      expect(Number.isInteger(c.offset ?? 0) && (c.offset ?? 0) >= 0).toBe(true);
    }
    for (const id of [r.id, ...r.cells.map((c) => c.id)]) {
      expect(id).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
      expect(ids.has(id), id).toBe(false);
      ids.add(id);
    }
  }
  const placed = l.rows.flatMap((r) => r.cells.flatMap((c) => (c.item ? [c.item] : [])));
  expect([...placed].sort()).toEqual(before.items.map((i) => i.id).sort());
  // giữ 100 % item theo thứ tự cũ, mọi trường trừ vị trí
  expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
  after.items.forEach((it, i) => {
    for (const k of POS) expect(k in it, `${it.id}.${k}`).toBe(false);
    expect(it).toEqual(without(before.items[i]!));
  });
  expect(report.rows).toBe(l.rows.length);
  expect(report.layout).toEqual(l.rows.map((r) => r.cells.map((c) => [c.offset ?? 0, c.span])));
}

describe('convertToGrid: quy tắc chia hàng và cột', () => {
  it('màn hình rỗng: một hàng 12 cột trống như màn hình lưới mới', () => {
    const d = free([]);
    const { doc, report } = convertToGrid(d);
    expect(shape(doc)).toEqual([[[0, 12, null]]]);
    expect(report.rows).toBe(1);
    expect(report.warnings).toEqual([]);
    expect(doc.items).toEqual([]);
  });

  it('một item: chiều rộng và khoảng trống bên trái theo tỷ lệ / 12', () => {
    expect(shape(convertToGrid(free([{ id: 'a', x: 0, y: 0, w: 1200, h: 80 }])).doc)).toEqual([
      [[0, 12, 'a']],
    ]);
    expect(shape(convertToGrid(free([{ id: 'a', x: 300, y: 40, w: 300, h: 80 }])).doc)).toEqual([
      [[3, 3, 'a']],
    ]);
    // item hẹp vẫn chiếm ít nhất 1 cột
    expect(shape(convertToGrid(free([{ id: 'a', x: 0, y: 0, w: 10, h: 10 }])).doc)).toEqual([
      [[0, 1, 'a']],
    ]);
  });

  it('hai cột: mỗi dòng thành một hàng 6 + 6, thứ tự đọc trên xuống, trái sang phải', () => {
    const d = free([
      { id: 'b2', x: 600, y: 300, w: 600, h: 200 },
      { id: 'a1', x: 0, y: 0, w: 600, h: 200 },
      { id: 'a2', x: 600, y: 10, w: 600, h: 180 },
      { id: 'b1', x: 0, y: 310, w: 600, h: 200 },
    ]);
    const { doc, report } = convertToGrid(d);
    expect(shape(doc)).toEqual([
      [
        [0, 6, 'a1'],
        [0, 6, 'a2'],
      ],
      [
        [0, 6, 'b1'],
        [0, 6, 'b2'],
      ],
    ]);
    expectInvariants(d, doc, report);
  });

  it('kịch bản 1 của US5: 6 widget xếp 2 dòng thành 2 hàng, độ rộng làm tròn theo 12 cột', () => {
    const d = free([
      { id: 'a', x: 20, y: 20, w: 380, h: 100 },
      { id: 'b', x: 410, y: 20, w: 380, h: 100 },
      { id: 'c', x: 800, y: 20, w: 380, h: 100 },
      { id: 'd', x: 20, y: 200, w: 560, h: 100 },
      { id: 'e', x: 600, y: 210, w: 280, h: 80 },
      { id: 'f', x: 900, y: 200, w: 280, h: 100 },
    ]);
    const { doc, report } = convertToGrid(d);
    expect(report.rows).toBe(2);
    expect(spans(doc)).toEqual([
      [4, 4, 4],
      [6, 3, 3],
    ]);
    expectInvariants(d, doc, report);
  });

  it('item chồng lấn theo y gộp một hàng; chồng lấn theo x vẫn ≥ 1 cột, tổng ≤ 12 và có cảnh báo', () => {
    const d = free([
      { id: 'panel', x: 0, y: 0, w: 800, h: 400 },
      { id: 'in1', x: 20, y: 40, w: 300, h: 100 },
      { id: 'in2', x: 340, y: 40, w: 300, h: 100 },
      { id: 'side', x: 820, y: 380, w: 380, h: 100 },
      { id: 'below', x: 0, y: 600, w: 1200, h: 100 },
    ]);
    const { doc, report } = convertToGrid(d);
    expect(report.rows).toBe(2);
    expect(L(doc).rows[0]!.cells.map((c) => c.item)).toEqual(['panel', 'in1', 'in2', 'side']);
    expect(shape(doc)[1]).toEqual([[0, 12, 'below']]);
    expect(report.warnings.find((w) => w.code === 'overlap')?.items).toEqual(['in1', 'in2']);
    expectInvariants(d, doc, report);
  });

  it('20 widget (SC-010): giữ cả 20 và mọi binding, 5 hàng 3 + 3 + 3 + 3', () => {
    const boxes: Box[] = [];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 4; c++)
        boxes.push({ id: `w${r * 4 + c + 1}`, x: c * 300 + 10, y: r * 150 + 10, w: 280, h: 120 });
    const d = free(boxes);
    const { doc, report } = convertToGrid(d);
    expect(report.rows).toBe(5);
    expect(spans(doc)).toEqual(Array.from({ length: 5 }, () => [3, 3, 3, 3]));
    expect(doc.items).toHaveLength(20);
    expectInvariants(d, doc, report);
  });

  it('hàng quá 12 item tách thành nhiều hàng (mỗi hàng ≤ 12 ô), có cảnh báo', () => {
    const boxes: Box[] = Array.from({ length: 14 }, (_, i) => ({
      id: `n${i + 1}`,
      x: i * 85,
      y: 0,
      w: 80,
      h: 40,
    }));
    const d = free(boxes);
    const { doc, report } = convertToGrid(d);
    expect(L(doc).rows.map((r) => r.cells.length)).toEqual([12, 2]);
    expect(L(doc).rows[1]!.cells.map((c) => c.item)).toEqual(['n13', 'n14']);
    expect(report.warnings.map((w) => w.code)).toContain('split');
    expectInvariants(d, doc, report);
  });

  it('chiều cao hàng: auto, trừ khi item cao hơn 120 px (giữ chiều cao lớn nhất của hàng)', () => {
    const d = free([
      { id: 'btn', x: 0, y: 0, w: 300, h: 48 },
      { id: 'trend', x: 0, y: 100, w: 600, h: 280 },
      { id: 'lamp', x: 620, y: 120, w: 100, h: 40 },
    ]);
    const { doc } = convertToGrid(d);
    expect(L(doc).rows.map((r) => r.height)).toEqual(['auto', 280]);
  });

  it('item ẩn, item svg và mọi thuộc tính, sự kiện, bảo mật được giữ; đầu vào không đổi', () => {
    const d = free([
      { id: 'a', x: 0, y: 0, w: 600, h: 100, hidden: true },
      { id: 'b', x: 600, y: 0, w: 600, h: 100 },
    ]);
    (d.items as unknown[]).push({
      id: 'svg1',
      type: 'svg',
      name: 'Đồ họa',
      x: 0,
      y: 200,
      width: 400,
      height: 400,
      svgFile: 'screens/cu.svg',
      bindingFile: 'screens/cu.bindings.json',
      viewBox: [0, 0, 100, 100],
      elements: [{ elementUid: 'el_a' }],
    });
    const b = d.items[1] as unknown as Record<string, unknown>;
    b.events = { click: { action: 'navigate', screen: 'main' } };
    b.security = { minRole: 'engineer' };
    const snapshot = JSON.stringify(d);
    const { doc, report } = convertToGrid(d);
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(shape(doc)).toEqual([
      [
        [0, 6, 'a'],
        [0, 6, 'b'],
      ],
      [[0, 4, 'svg1']],
    ]);
    expect((doc.items[0] as { hidden?: boolean }).hidden).toBe(true);
    expectInvariants(d, doc, report);
  });

  it('màn hình đã là lưới: trả đúng doc cũ, không có hàng nào được đề xuất', () => {
    const d = convertToGrid(free([{ id: 'a', x: 0, y: 0, w: 100, h: 100 }])).doc;
    const r = convertToGrid(d);
    expect(r.doc).toBe(d);
    expect(r.report.warnings.map((w) => w.code)).toEqual(['already-grid']);
  });
});

/** Chuyển mọi màn hình tự do của project rồi kiểm bằng validateProject. */
async function convertAll(files: Record<string, string>, only?: string) {
  const out = { ...files };
  const converted: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    if (!/^screens\/[^/]+\.screen\.json$/.test(rel)) continue;
    const screen = JSON.parse(text) as ScreenModel & { layout?: unknown };
    if (screen.layout !== undefined || (only !== undefined && screen.id !== only)) continue;
    const { doc } = convertToGrid(screen);
    expectInvariants(screen, doc, convertToGrid(screen).report);
    out[rel] = formatScreen03(doc);
    converted.push(screen.id);
  }
  const v = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: '1.1.0',
  });
  return { converted, errors: v.errors, warnings: v.warnings };
}

describe('convertToGrid: kết quả qua validateProject (định dạng 1.1)', () => {
  it('vector v11-valid-full: màn hình tự do `main` (item svg, template, chồng lấn) chuyển hợp lệ', async () => {
    const files = readProjectDir(resolve(REPO, 'tests/project-vectors/v11-valid-full'));
    delete files['expected.json'];
    const r = await convertAll(files, 'main');
    expect(r.converted).toEqual(['main']);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.code.startsWith('W_LAYOUT'))).toEqual([]);
  });

  it('dashboard-demo sau migrateTo11: mọi màn hình tự do chuyển hợp lệ', async () => {
    const m = await migrateTo11(readProjectDir(DASHBOARD_DEMO));
    expect(m.ok, JSON.stringify(m)).toBe(true);
    if (!m.ok) return;
    const r = await convertAll(m.files);
    expect(r.converted.length).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.code.startsWith('W_LAYOUT'))).toEqual([]);
  });

  it('tank-demo sau migrateTo11: màn hình `tank-motor` (quickstart §6) chuyển hợp lệ', async () => {
    const m = await migrateTo11(tankDemo());
    expect(m.ok, JSON.stringify(m)).toBe(true);
    if (!m.ok) return;
    const r = await convertAll(m.files, 'tank-motor');
    expect(r.converted).toEqual(['tank-motor']);
    expect(r.errors).toEqual([]);
  });
});
