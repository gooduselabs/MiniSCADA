// Feature 035: dời component giữa các hàng, đổi thứ tự hàng, sao chép, dán, nhân bản ô và hàng trên màn hình lưới.
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  copyCell,
  copyRow,
  duplicateCell,
  duplicateRow,
  moveCellTo,
  moveItemToCell,
  moveRowTo,
  pasteGrid,
} from './grid-ops.ts';

type G = ScreenModel & { layout: GridLayout };
const gauge = {
  id: 'gauge_1',
  type: 'widget',
  widget: 'gauge',
  name: 'Áp suất',
  tags: { value: 'PT_101' },
  props: { title: 'Áp', zones: [{ from: 0, to: 10, color: '#c42b2b' }] },
  events: { click: { action: 'navigate', screen: 'chi-tiet' } },
  security: { minRole: 'operator' },
};
const doc = (): G =>
  ({
    schemaVersion: '1.1.0',
    id: 's',
    name: 'S',
    kind: 'screen',
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
            { id: 'c1', span: 4, item: 'gauge_1' },
            { id: 'c2', span: 4 },
          ],
        },
        { id: 'r2', height: 200, cells: [{ id: 'c3', span: 6, item: 'card_1' }] },
        { id: 'r3', height: 'auto', cells: [{ id: 'c4', span: 12 }] },
      ],
    },
    items: [gauge, { id: 'card_1', type: 'widget', widget: 'card' }],
  }) as unknown as G;
const L = (d: ScreenModel) => (d as G).layout;
const ids = (d: ScreenModel) =>
  L(d).rows.map((r) => `${r.id}:${r.cells.map((c) => c.id).join(',')}`);

describe('feature 035: dời ô và component', () => {
  it('dời ô sang hàng khác ở vị trí chỉ định, giữ component', () => {
    const r = moveCellTo(doc(), 'c1', 'r2', 1);
    expect(r.rejected).toBeUndefined();
    expect(ids(r.doc)).toEqual(['r1:c2', 'r2:c3,c1', 'r3:c4']);
    expect(L(r.doc).rows[1]!.cells[1]).toEqual({ id: 'c1', span: 4, item: 'gauge_1' });
    expect(r.selection).toEqual(['gauge_1']);
  });
  it('hàng đích thiếu chỗ thì ô co lại; hàng đầy thì từ chối', () => {
    const r = moveCellTo(doc(), 'c3', 'r1', 0);
    expect(L(r.doc).rows[0]!.cells.map((c) => `${c.id}/${c.span}`)).toEqual([
      'c3/4',
      'c1/4',
      'c2/4',
    ]);
    // hàng nguồn trống hẳn bị xóa
    expect(L(r.doc).rows.map((x) => x.id)).toEqual(['r1', 'r3']);
    expect(moveCellTo(doc(), 'c1', 'r3', 0).rejected).toBe('row-overflow');
  });
  it('đổi chỗ trong cùng hàng', () => {
    expect(ids(moveCellTo(doc(), 'c1', 'r1', 2).doc)[0]).toBe('r1:c2,c1');
    const same = doc();
    expect(moveCellTo(same, 'c1', 'r1', 0).doc).toBe(same);
  });
  it('đưa component vào ô trống, đổi component khi ô đích đã có', () => {
    const a = moveItemToCell(doc(), 'c1', 'c4');
    expect(L(a.doc).rows[0]!.cells[0]!.item).toBeUndefined();
    expect(L(a.doc).rows[2]!.cells[0]!.item).toBe('gauge_1');
    const b = moveItemToCell(doc(), 'c1', 'c3');
    expect(L(b.doc).rows[0]!.cells[0]!.item).toBe('card_1');
    expect(L(b.doc).rows[1]!.cells[0]!.item).toBe('gauge_1');
    expect(b.doc.items).toHaveLength(2);
  });
  it('dời hàng tới vị trí bất kỳ', () => {
    expect(L(moveRowTo(doc(), 'r3', 0).doc).rows.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
    expect(L(moveRowTo(doc(), 'r1', 3).doc).rows.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
    const d = doc();
    expect(moveRowTo(d, 'r1', 1).doc).toBe(d);
  });
  it('không sửa tài liệu đầu vào', () => {
    const d = doc();
    const before = JSON.stringify(d);
    moveCellTo(d, 'c1', 'r2', 0);
    moveItemToCell(d, 'c1', 'c3');
    moveRowTo(d, 'r3', 0);
    duplicateRow(d, 'r1');
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('feature 035: sao chép, dán, nhân bản', () => {
  it('nhân bản ô: chèn sau ô, item id mới, giữ nguyên mọi thuộc tính, Tag, sự kiện, bảo mật', () => {
    const r = duplicateCell(doc(), 'c3');
    expect(r.rejected).toBeUndefined();
    const row = L(r.doc).rows[1]!;
    expect(row.cells.map((c) => c.span)).toEqual([6, 6]);
    const g = duplicateCell(doc(), 'c1');
    // hàng 1 còn 4 cột trống: bản sao ngay sau c1
    const cells = L(g.doc).rows[0]!.cells;
    expect(cells).toHaveLength(3);
    const newId = cells[1]!.item!;
    expect(newId).toBe('gauge_2');
    expect(g.selection).toEqual(['gauge_2']);
    const copy = g.doc.items.find((i) => i.id === newId)!;
    expect({ ...copy, id: 'x' }).toEqual({ ...gauge, id: 'x' });
    // bản sao sâu: đổi bản sao không đổi bản gốc
    expect((copy as unknown as typeof gauge).props.zones).not.toBe(gauge.props.zones);
  });
  it('nhân bản ô khi hàng hết chỗ: hàng mới ngay dưới, cùng chiều cao hàng', () => {
    const d = doc();
    const full = {
      ...d,
      layout: {
        ...d.layout,
        rows: [
          d.layout.rows[1]!,
          { id: 'r9', height: 'auto' as const, cells: [{ id: 'c9', span: 12, item: 'gauge_1' }] },
        ],
      },
    } as G;
    const r = duplicateCell(full, 'c9');
    const rows = L(r.doc).rows;
    expect(rows).toHaveLength(3);
    expect(rows[2]!.cells[0]!.span).toBe(12);
    expect(rows[2]!.cells[0]!.item).toBe('gauge_2');
    const allIds = rows.flatMap((x) => [x.id, ...x.cells.map((c) => c.id)]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
  it('nhân bản hàng: mọi ô và component có id mới, đặt ngay dưới', () => {
    const r = duplicateRow(doc(), 'r1');
    const rows = L(r.doc).rows;
    expect(rows).toHaveLength(4);
    const dup = rows[1]!;
    expect(dup.id).not.toBe('r1');
    expect(dup.cells.map((c) => c.span)).toEqual([4, 4]);
    expect(dup.cells[0]!.item).toBe('gauge_2');
    expect(dup.cells[1]!.item).toBeUndefined();
    const allIds = rows.flatMap((x) => [x.id, ...x.cells.map((c) => c.id)]);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(r.doc.items.map((i) => i.id)).toEqual(['gauge_1', 'card_1', 'gauge_2']);
    expect(dup.height).toBe('auto');
    expect(L(duplicateRow(doc(), 'r2').doc).rows[2]!.height).toBe(200);
  });
  it('dán ô vào ô trống đang chọn; dán lần hai cũng ra id mới', () => {
    const clip = copyCell(doc(), 'c1')!;
    const a = pasteGrid(doc(), clip, 'c4');
    expect(L(a.doc).rows[2]!.cells[0]!.item).toBe('gauge_2');
    const b = pasteGrid(a.doc, clip, 'c4');
    // ô đích đã có: chèn sau (hàng đầy 12 cột thì hàng mới)
    expect(L(b.doc).rows).toHaveLength(4);
    expect(L(b.doc).rows[3]!.cells[0]!.item).toBe('gauge_3');
  });
  it('dán hàng sau hàng của ô chọn', () => {
    const clip = copyRow(doc(), 'r2')!;
    const r = pasteGrid(doc(), clip, 'c1');
    expect(L(r.doc).rows).toHaveLength(4);
    expect(L(r.doc).rows[1]!.cells[0]!.item).toBe('card_2');
  });
  it('item svg không nhân bản được', () => {
    const d = doc();
    const s = {
      ...d,
      items: [
        ...d.items,
        { id: 'svg_1', type: 'svg', file: 'a.svg', bindingFile: 'a.bindings.json' },
      ],
      layout: {
        ...d.layout,
        rows: [
          ...d.layout.rows,
          { id: 'r5', height: 'auto' as const, cells: [{ id: 'c5', span: 6, item: 'svg_1' }] },
        ],
      },
    } as unknown as G;
    expect(duplicateCell(s, 'c5').rejected).toBe('svg-copy');
    expect(duplicateRow(s, 'r5').rejected).toBe('svg-copy');
  });
});
