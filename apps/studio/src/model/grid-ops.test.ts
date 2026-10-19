// Thao tác thuần của trình soạn lưới (feature 012, T023; FR-016 đến FR-021): (doc, ...) → { doc, selection?, rejected? }
// như screen-doc.ts; không đổi đầu vào; không có gì đổi thì trả đúng `doc` cũ (không tạo bước hoàn tác rỗng).
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  addCell,
  addRow,
  attachWidget,
  emptyGridLayout,
  GRID_PRESETS,
  moveCell,
  moveRow,
  removeCell,
  removeRow,
  replaceWidget,
  resizeDivider,
  setCellProps,
  setRowProps,
} from './grid-ops.ts';
import { remove } from './screen-doc.ts';

type G = ScreenModel & { layout: GridLayout };
const doc = (): G =>
  ({
    schemaVersion: '1.1.0',
    id: 'tong-quan',
    name: 'Tổng quan',
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
            { id: 'c1', span: 4, item: 'card_1' },
            { id: 'c2', span: 4 },
            { id: 'c3', span: 4 },
          ],
        },
      ],
    },
    items: [{ id: 'card_1', type: 'widget', widget: 'card' }],
  }) as unknown as G;
const L = (d: ScreenModel) => (d as G).layout;
const spans = (d: ScreenModel, r = 0) => L(d).rows[r]!.cells.map((c) => c.span);

describe('grid-ops', () => {
  it('mẫu cột có sẵn (FR-016), tổng mỗi mẫu = 12', () => {
    expect(GRID_PRESETS.map((p) => p.join('+'))).toEqual([
      '12',
      '6+6',
      '4+4+4',
      '3+3+3+3',
      '8+4',
      '4+8',
      '3+6+3',
    ]);
    for (const p of GRID_PRESETS) expect(p.reduce((a, b) => a + b, 0)).toBe(12);
    expect(emptyGridLayout().rows).toEqual([
      { id: 'r1', height: 'auto', cells: [{ id: 'c1', span: 12 }] },
    ]);
  });

  it('addRow: thêm hàng theo mẫu ở cuối hoặc ở vị trí, id mới không trùng', () => {
    const d = doc();
    const r = addRow(d, [8, 4]);
    expect(L(r.doc).rows).toHaveLength(2);
    expect(L(r.doc).rows[1]).toEqual({
      id: 'r2',
      height: 'auto',
      cells: [
        { id: 'c4', span: 8 },
        { id: 'c5', span: 4 },
      ],
    });
    expect(L(d).rows).toHaveLength(1); // không đổi đầu vào
    const first = addRow(d, [12], 0);
    expect(L(first.doc).rows[0]!.cells).toEqual([{ id: 'c4', span: 12 }]);
    expect(addRow(d, [6, 7]).rejected).toBe('row-overflow');
    expect(addRow(d, []).rejected).toBe('bad-preset');
  });

  it('addRow: tối đa 100 hàng', () => {
    let d: ScreenModel = doc();
    for (let i = 0; i < 99; i++) d = addRow(d, [12]).doc;
    expect(L(d).rows).toHaveLength(100);
    const r = addRow(d, [12]);
    expect(r.rejected).toBe('max-rows');
    expect(r.doc).toBe(d);
  });

  it('attachWidget: tạo item không có tọa độ, ô trỏ tới nó, chọn item mới; ô đã có thì từ chối', () => {
    const r = attachWidget(doc(), 'c2', 'gauge');
    expect(r.rejected).toBeUndefined();
    const it = r.doc.items.find((i) => i.id === 'gauge_1')!;
    expect(it).toEqual({ id: 'gauge_1', type: 'widget', widget: 'gauge' });
    expect(L(r.doc).rows[0]!.cells[1]!.item).toBe('gauge_1');
    expect(r.selection).toEqual(['gauge_1']);
    expect(attachWidget(doc(), 'c1', 'gauge').rejected).toBe('cell-occupied');
    expect(attachWidget(doc(), 'zz', 'gauge').rejected).toBe('unknown-cell');
    expect(attachWidget(doc(), 'c2', 'khong-co').rejected).toBe('unknown-widget');
  });

  it('replaceWidget: thay component của ô, item cũ bị xóa', () => {
    const r = replaceWidget(doc(), 'c1', 'lamp');
    expect(r.doc.items.map((i) => i.id)).toEqual(['lamp_1']);
    expect(L(r.doc).rows[0]!.cells[0]!.item).toBe('lamp_1');
  });

  it('resizeDivider: đổi span hai ô kề nhau, bám 1/12, mỗi ô tối thiểu 1', () => {
    const r = resizeDivider(doc(), 'r1', 0, 2);
    expect(spans(r.doc)).toEqual([6, 2, 4]);
    expect(spans(resizeDivider(doc(), 'r1', 1, -3).doc)).toEqual([4, 1, 7]);
    const clamp = resizeDivider(doc(), 'r1', 0, 10);
    expect(spans(clamp.doc)).toEqual([7, 1, 4]);
    expect(resizeDivider(doc(), 'r1', 2, 1).rejected).toBe('unknown-cell');
    const d = doc();
    expect(resizeDivider(d, 'r1', 0, 0).doc).toBe(d);
  });

  it('setCellProps: span, offset, align, minHeight; tổng vượt 12 bị từ chối', () => {
    const r = setCellProps(doc(), 'c3', { span: 3, offset: 1, align: 'center', minHeight: 120 });
    expect(L(r.doc).rows[0]!.cells[2]).toEqual({
      id: 'c3',
      span: 3,
      offset: 1,
      align: 'center',
      minHeight: 120,
    });
    expect(setCellProps(doc(), 'c3', { span: 5 }).rejected).toBe('row-overflow');
    const back = setCellProps(r.doc, 'c3', { offset: 0, align: 'stretch', minHeight: 0 });
    expect(L(back.doc).rows[0]!.cells[2]).toEqual({ id: 'c3', span: 3 });
  });

  it('setRowProps: chiều cao auto hoặc px (24 đến 4.000), khoảng cách', () => {
    const r = setRowProps(doc(), 'r1', { height: 320, gap: 8 });
    expect(L(r.doc).rows[0]).toMatchObject({ height: 320, gap: 8 });
    expect(L(setRowProps(doc(), 'r1', { height: 10 }).doc).rows[0]!.height).toBe(24);
    expect(L(setRowProps(r.doc, 'r1', { height: 'auto', gap: null }).doc).rows[0]).toEqual(
      expect.not.objectContaining({ gap: expect.anything() }),
    );
  });

  it('addCell: thêm ô vào hàng với phần cột còn trống; hàng đầy thì từ chối', () => {
    const d = setCellProps(doc(), 'c3', { span: 2 }).doc;
    const r = addCell(d, 'r1');
    expect(L(r.doc).rows[0]!.cells.at(-1)).toEqual({ id: 'c4', span: 2 });
    expect(addCell(doc(), 'r1').rejected).toBe('row-overflow');
  });

  it('moveRow, moveCell: đổi thứ tự; ở mép thì không đổi', () => {
    const d = addRow(doc(), [12]).doc;
    const up = moveRow(d, 'r2', -1);
    expect(L(up.doc).rows.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(moveRow(d, 'r1', -1).doc).toBe(d);
    const right = moveCell(doc(), 'c1', 1);
    expect(L(right.doc).rows[0]!.cells.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
  });

  it('removeCell, removeRow: xóa cả item trong đó', () => {
    const rc = removeCell(doc(), 'c1');
    expect(L(rc.doc).rows[0]!.cells.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(rc.doc.items).toEqual([]);
    const rr = removeRow(doc(), 'r1');
    expect(L(rr.doc).rows).toEqual([]);
    expect(rr.doc.items).toEqual([]);
  });

  it('screen-doc remove trên màn hình lưới: ô trỏ item bị xóa thành ô trống', () => {
    const r = remove(doc(), ['card_1']);
    expect(r.doc.items).toEqual([]);
    expect(L(r.doc).rows[0]!.cells[0]).toEqual({ id: 'c1', span: 4 });
  });
});

describe('placeInGrid (nhập SVG, ký hiệu vào màn hình lưới)', () => {
  it('bỏ tọa độ của item, đặt vào ô trống đầu tiên; hết ô trống thì thêm hàng 12 cột', async () => {
    const { placeInGrid } = await import('./grid-ops.ts');
    const it = { id: 'svg_1', type: 'svg', x: 0, y: 0, width: 400, height: 300 } as never;
    const one = placeInGrid(doc(), it) as G;
    expect(one.items.at(-1)).toEqual({ id: 'svg_1', type: 'svg' });
    expect(one.layout.rows[0]!.cells[1]!.item).toBe('svg_1');
    let full: ScreenModel = doc();
    full = placeInGrid(full, { id: 'a2', type: 'widget', widget: 'card' } as never);
    full = placeInGrid(full, { id: 'a3', type: 'widget', widget: 'card' } as never);
    const more = placeInGrid(full, it) as G;
    expect(more.layout.rows).toHaveLength(2);
    expect(more.layout.rows[1]!.cells).toEqual([{ id: 'c4', span: 12, item: 'svg_1' }]);
  });
});
