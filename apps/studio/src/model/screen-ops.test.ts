// Thao tác màn hình ở cấp project (feature 007, T109): id mới, màn hình mới, nhân bản, chỗ trỏ tới, đặt màn hình đầu.
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  outlineOf,
  withEditable,
  type ProjectDocs,
} from './project-doc.ts';
import {
  newScreen,
  newScreenId,
  planAddScreen,
  planDuplicateScreen,
  planRemoveScreen,
  planSetEntry,
  screenRefs,
} from './screen-ops.ts';
import { dashboardDemo } from './test-fixtures.ts';

function docs(): ProjectDocs {
  const out: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(dashboardDemo()))
    out[rel] = loadDoc(rel, text, 'h', false);
  return withEditable(out);
}
const outline = (d: ProjectDocs) => outlineOf(filesOf(d));

describe('id và màn hình mới', () => {
  it('id nhỏ nhất chưa dùng theo loại', () => {
    expect(newScreenId([], 'screen')).toBe('man-hinh-1');
    expect(newScreenId(['man-hinh-1', 'man-hinh-3'], 'screen')).toBe('man-hinh-2');
    expect(newScreenId(['man-hinh-1'], 'popup')).toBe('popup-1');
  });

  it('màn hình rỗng: cỡ 1920 x 1080, popup 640 x 420, fitMode contain', () => {
    expect(newScreen('screen', 'a', 'A')).toMatchObject({
      kind: 'screen',
      size: { width: 1920, height: 1080 },
      fitMode: 'contain',
      items: [],
    });
    expect(newScreen('popup', 'p', 'P').size).toEqual({ width: 640, height: 420 });
  });

  it('thêm màn hình và popup vào project: hợp lệ về cấu trúc, id không trùng', () => {
    const d = docs();
    const plan = planAddScreen(outline(d), 'screen', (n) => `Màn hình mới ${n}`)!;
    const next = applyDocEdits(d, plan.edits);
    const o = outline(next);
    expect(o.screens.map((s) => s.id)).toContain(plan.id);
    expect(o.screens.find((s) => s.id === plan.id)!.model!.name).toBe('Màn hình mới 1');
    const again = planAddScreen(o, 'screen', (n) => `Màn hình mới ${n}`)!;
    expect(again.id).toBe('man-hinh-2');
  });
});

describe('nhân bản', () => {
  it('bản sao có id mới, tên có hậu tố, bỏ item svg (một file binding chỉ thuộc một item)', () => {
    const d = docs();
    const o = outline(d);
    const plan = planDuplicateScreen(o, 'tong-quan', (n) => `${n} (bản sao)`)!;
    expect(plan.id).toBe('tong-quan-2');
    expect(plan.skippedSvg).toBe(1);
    const copy = outline(applyDocEdits(d, plan.edits)).screens.find(
      (s) => s.id === plan.id,
    )!.model!;
    expect(copy.name).toBe('Tổng quan (bản sao)');
    expect(copy.items.some((i) => i.type === 'svg')).toBe(false);
    expect(copy.items.length).toBe(o.screens[0]!.model!.items.length - 1);
  });
});

describe('chỗ trỏ tới màn hình', () => {
  it('liệt kê màn hình đầu, mục menu và hành động của nút', () => {
    const o = outline(docs());
    const entry = screenRefs(o, 'tong-quan');
    expect(entry.some((r) => r.kind === 'entry')).toBe(true);
    expect(entry.some((r) => r.kind === 'nav')).toBe(true);
    const pop = screenRefs(o, 'bom1');
    expect(pop.some((r) => r.kind === 'action' && r.action === 'popup')).toBe(true);
  });

  it('xóa màn hình: id khỏi project.json, file bị xóa; chỗ trỏ thành lỗi do bộ kiểm tra báo', () => {
    const d = docs();
    const next = applyDocEdits(d, planRemoveScreen('bom1'));
    expect(outline(next).screens.map((s) => s.id)).not.toContain('bom1');
    expect(next['screens/bom1.screen.json']!.removed).toBe(true);
  });
});

describe('màn hình đầu', () => {
  it('chỉ đặt được màn hình thường', () => {
    const o = outline(docs());
    expect(planSetEntry(o, 'bon-nuoc')).toEqual([
      { kind: 'project', field: 'entryScreen', value: 'bon-nuoc' },
    ]);
    expect(planSetEntry(o, 'bom1')).toBeNull();
    expect(planSetEntry(o, 'khong-co')).toBeNull();
  });
});
