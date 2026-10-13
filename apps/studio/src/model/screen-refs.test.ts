// Tham chiếu của màn hình 0.3 trong Studio (feature 007, T110, FR-069): "Dùng ở đâu" cho widget, đổi tên Tag cập nhật khe
// của widget thành một bước hoàn tác, đổi tên bảng giá trị cập nhật `props.table`, ánh xạ lỗi tới item và ô.
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  outlineOf,
  snapshotOf,
  withEditable,
} from './project-doc.ts';
import type { ProjectDocs } from './project-doc.ts';
import { locate } from './issue-map.ts';
import { planRename } from './rename-flow.ts';
import { dashboardDemo } from './test-fixtures.ts';
import { whereUsed, whereUsedTable, xrefLocation, xrefText } from './xref.ts';

function docs(): ProjectDocs {
  const out: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(dashboardDemo()))
    out[rel] = loadDoc(rel, text, 'h', false);
  return withEditable(out);
}

/** dashboard-demo có `select_mode` dùng bảng giá trị của Tag; ở đây gắn thẳng `props.table`. */
function docsWithTable(): ProjectDocs {
  const d = docs();
  const o = outlineOf(filesOf(d));
  const screen = structuredClone(o.screens[0]!.model!);
  const sel = screen.items.find((i) => i.id === 'select_mode')!;
  if (sel.type === 'widget') sel.props = { ...sel.props, table: 'TrangThaiBom' };
  return applyDocEdits(d, [{ kind: 'screenUpsert', screen }]);
}

describe('"Dùng ở đâu" của widget 0.3', () => {
  it('liệt kê item theo khe, có tên màn hình và vị trí tới item', () => {
    const o = outlineOf(filesOf(docs()));
    const hits = whereUsed(o, 'TANK01.LEVEL').filter((e) => e.kind === 'widget');
    expect(hits.map((e) => (e.kind === 'widget' ? e.item : ''))).toEqual(
      expect.arrayContaining(['level_tank', 'card_level', 'gauge_level', 'line_trend']),
    );
    const first = hits.find((e) => e.kind === 'widget' && e.item === 'card_level')!;
    expect(xrefText(first)).toBe('Tổng quan › Mức nước (khe value)');
    expect(xrefLocation(first)).toEqual({
      editor: 'screen',
      screen: 'tong-quan',
      item: 'card_level',
    });
  });

  it('bảng giá trị dùng ở select (props.table)', () => {
    const o = outlineOf(filesOf(docsWithTable()));
    const hits = whereUsedTable(o, 'TrangThaiBom');
    expect(hits.some((e) => e.kind === 'widgetTable' && e.item === 'select_mode')).toBe(true);
  });
});

describe('đổi tên Tag và bảng giá trị với widget', () => {
  it('planRename: sửa đổi màn hình trong MỘT bước hoàn tác, item đổi đúng khe', () => {
    const d = docs();
    const o = outlineOf(filesOf(d));
    const plan = planRename(o, 'TANK01.LEVEL', 'BON1.MUC');
    if (!plan.ok) throw new Error(plan.code);
    expect(plan.items.length).toBeGreaterThan(3);
    const next = applyDocEdits(d, plan.change.edits);
    const o2 = outlineOf(filesOf(next));
    const card = o2.screens[0]!.model!.items.find((i) => i.id === 'card_level')!;
    expect(card.type === 'widget' && card.tags).toEqual({ value: 'BON1.MUC' });
    const line = o2.screens[0]!.model!.items.find((i) => i.id === 'line_trend')!;
    expect(line.type === 'widget' && line.tags?.series).toEqual([
      'BON1.MUC',
      'TANK01.SP',
      'DEMO.WAVE',
    ]);
    expect(whereUsed(o2, 'TANK01.LEVEL').filter((e) => e.kind === 'widget')).toEqual([]);
    expect(snapshotOf(next)).not.toBe(snapshotOf(d));
  });

  it('đổi tên bảng giá trị cập nhật props.table của widget', () => {
    const d = docsWithTable();
    const next = applyDocEdits(d, [
      { kind: 'valueTableRename', from: 'TrangThaiBom', to: 'TrangThai2' },
    ]);
    const o = outlineOf(filesOf(next));
    const sel = o.screens[0]!.model!.items.find((i) => i.id === 'select_mode')!;
    expect(sel.type === 'widget' && sel.props?.table).toBe('TrangThai2');
  });
});

describe('ánh xạ lỗi của màn hình 0.3', () => {
  it('đường dẫn /items/N/... trỏ tới item và ô', () => {
    const o = outlineOf(filesOf(docs()));
    const file = 'screens/tong-quan.screen.json';
    const i = o.screens[0]!.model!.items.findIndex((x) => x.id === 'card_level');
    const at = (path: string) => locate({ code: 'E_WIDGET_PROP', file, path, message: '' }, o);
    expect(at(`/items/${i}/props/decimals`)).toEqual({
      editor: 'screen',
      screen: 'tong-quan',
      item: 'card_level',
      field: 'prop:decimals',
    });
    expect(at(`/items/${i}/tags/value`)).toMatchObject({ field: 'tag:value' });
    expect(at(`/items/${i}/width`)).toMatchObject({ field: 'rect' });
    expect(at(`/items/${i}`)).toEqual({
      editor: 'screen',
      screen: 'tong-quan',
      item: 'card_level',
    });
    expect(at('/size')).toEqual({ editor: null });
  });
});
