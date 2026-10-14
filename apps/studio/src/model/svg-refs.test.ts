// Đổi tên Tag, "Dùng ở đâu" và xóa màn hình với phần tử SVG (feature 008, T075; FR-047): mở rộng rename-flow, xref, screen-ops
// trên dashboard-demo (màn hình `tong-quan` có item `svg1`), file binding thay bằng bộ có sự kiện.
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  outlineOf,
  withEditable,
  snapshotOf,
  writtenText,
} from './project-doc.ts';
import type { ProjectDocs } from './project-doc.ts';
import { planRename } from './rename-flow.ts';
import { screenRefs } from './screen-ops.ts';
import { dashboardDemo } from './test-fixtures.ts';
import { whereUsed, whereUsedTable, xrefLocation, xrefText } from './xref.ts';

const BIND = 'screens/tong-quan.bindings.json';
const set04 = {
  schemaVersion: '0.3.0',
  screenId: 'tong-quan',
  itemId: 'svg1',
  elements: [
    {
      elementUid: 'el_tank',
      bindings: [
        {
          id: 'level',
          target: 'geometry.clipLevel',
          source: { type: 'tag', tagId: 'TANK01.LEVEL' },
          transform: { kind: 'direct' },
        },
        {
          id: 'tbl',
          target: 'style.fill',
          source: { type: 'tag', tagId: 'PUMP01.STATE' },
          transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' },
        },
      ],
    },
    {
      elementUid: 'el_pump',
      events: {
        click: {
          action: 'pulse',
          tag: 'PUMP01.RUN_CMD',
          value: true,
          durationMs: 500,
          label: 'Khởi động',
        },
      },
    },
    { elementUid: 'el_state', events: { click: { action: 'navigate', screen: 'giam-sat' } } },
  ],
};

function docs(): ProjectDocs {
  const raw = dashboardDemo();
  raw[BIND] = JSON.stringify(set04, null, 2);
  const out: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(raw)) out[rel] = loadDoc(rel, text, 'h', false);
  return withEditable(out);
}
const outline = () => outlineOf(filesOf(docs()));

describe('Dùng ở đâu: svgElement', () => {
  it('Tag của binding và của sự kiện ghi', () => {
    const lv = whereUsed(outline(), 'TANK01.LEVEL').filter((e) => e.kind === 'svgElement');
    expect(lv).toHaveLength(1);
    expect(xrefText(lv[0]!)).toBe('Tổng quan › Sơ đồ bồn và bơm › Bồn (Mức chất lỏng)');
    expect(xrefLocation(lv[0]!)).toEqual({
      editor: 'screen',
      screen: 'tong-quan',
      item: 'svg1',
      field: 'element:el_tank',
    });
    const cmd = whereUsed(outline(), 'PUMP01.RUN_CMD').filter((e) => e.kind === 'svgElement');
    expect(cmd).toHaveLength(1);
    expect(xrefText(cmd[0]!)).toBe('Tổng quan › Sơ đồ bồn và bơm › Bơm (sự kiện pulse)');
  });

  it('bảng giá trị dùng bởi binding của phần tử', () => {
    const r = whereUsedTable(outline(), 'TrangThaiBom').filter((e) => e.kind === 'svgElement');
    expect(r).toHaveLength(1);
    expect(xrefText(r[0]!)).toContain('bảng giá trị');
  });
});

describe('đổi tên Tag với phần tử SVG', () => {
  it('liệt kê binding và sự kiện; một bước hoàn tác sửa cả file binding', () => {
    const o = outline();
    const p = planRename(o, 'PUMP01.RUN_CMD', 'PUMP01.START');
    if (!p.ok) throw new Error(p.message);
    expect(p.items.map((i) => i.text)).toContain(
      'Tổng quan › Sơ đồ bồn và bơm › Bơm (sự kiện pulse)',
    );
    const edit = p.change.edits.find((e) => e.kind === 'svgBindings');
    expect(edit).toMatchObject({ kind: 'svgBindings', file: BIND });

    const d = docs();
    const before = snapshotOf(d);
    const after = applyDocEdits(d, p.change.edits);
    expect(snapshotOf(after)).not.toBe(before);
    const written = JSON.parse(writtenText(after[BIND]!)) as typeof set04;
    expect((written.elements[1]!.events!.click as { tag: string }).tag).toBe('PUMP01.START');
    const o2 = outlineOf(filesOf(after));
    expect(whereUsed(o2, 'PUMP01.RUN_CMD').filter((e) => e.kind === 'svgElement')).toEqual([]);
    expect(whereUsed(o2, 'PUMP01.START').filter((e) => e.kind === 'svgElement')).toHaveLength(1);
  });

  it('đổi Tag của binding (không phải sự kiện)', () => {
    const p = planRename(outline(), 'TANK01.LEVEL', 'TANK01.LVL');
    if (!p.ok) throw new Error(p.message);
    const after = applyDocEdits(docs(), p.change.edits);
    const written = JSON.parse(writtenText(after[BIND]!)) as typeof set04;
    expect(written.elements[0]!.bindings![0]!.source.tagId).toBe('TANK01.LVL');
  });
});

describe('xóa màn hình: sự kiện SVG trỏ tới', () => {
  it('liệt kê navigate của phần tử trỏ tới giam-sat', () => {
    const refs = screenRefs(outline(), 'giam-sat').filter((r) => r.kind === 'svgEvent');
    expect(refs).toEqual([
      {
        kind: 'svgEvent',
        screen: 'tong-quan',
        screenName: 'Tổng quan',
        item: 'svg1',
        itemName: 'Sơ đồ bồn và bơm',
        element: 'el_state',
        elementName: 'Trạng thái',
        action: 'navigate',
      },
    ]);
    expect(screenRefs(outline(), 'tong-quan').filter((r) => r.kind === 'svgEvent')).toEqual([]);
  });
});
