// Feature 037 vòng 2: Đổi thành…, sao chép/dán định dạng, kéo nhiều Tag thành hàng thẻ.
import type { ScreenModel, WidgetItem } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { emptyGridLayout } from './grid-ops.ts';
import {
  addTagRows,
  changeTargets,
  changeWidgetType,
  copyFormat,
  pasteFormat,
} from './widget-ops-037.ts';

const w = (id: string, widget: string, extra: Partial<WidgetItem> = {}) =>
  ({ id, type: 'widget', widget, x: 10, y: 20, width: 120, height: 40, ...extra }) as WidgetItem;
const free = (items: WidgetItem[]): ScreenModel =>
  ({
    schemaVersion: '1.1.0',
    id: 's',
    name: 'S',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items,
  }) as unknown as ScreenModel;

describe('Đổi thành…', () => {
  it('danh sách loại cùng nhóm, không có loại lỗi thời', () => {
    expect(changeTargets('card')).toContain('multi-state');
    expect(changeTargets('card')).not.toContain('stat-tile');
    expect(changeTargets('card')).not.toContain('card');
    expect(changeTargets('button')).toContain('switch');
  });
  it('card → gauge: giữ id, vị trí, nhãn, Tag chính; nới tới cỡ tối thiểu', () => {
    const doc = free([
      w('a', 'card', {
        props: { label: 'Áp suất', decimals: 2, accent: 'rose' },
        tags: { value: 'P' },
      }),
    ]);
    const r = changeWidgetType(doc, 'a', 'gauge');
    const it = r.doc.items[0] as WidgetItem;
    expect(it).toMatchObject({ id: 'a', widget: 'gauge', x: 10, y: 20, tags: { value: 'P' } });
    expect(it.props).toMatchObject({ label: 'Áp suất', decimals: 2 });
    expect(it.props!['accent']).toBeUndefined();
    expect(it.width).toBeGreaterThanOrEqual(120);
    expect(it.height).toBeGreaterThanOrEqual(100);
  });
  it('khe chính khác tên: card.value → equipment.state', () => {
    const r = changeWidgetType(
      free([w('a', 'card', { tags: { value: 'RUN' } })]),
      'a',
      'equipment',
    );
    expect((r.doc.items[0] as WidgetItem).tags).toEqual({ state: 'RUN' });
  });
  it('loại không cùng nhóm: từ chối, tài liệu giữ nguyên', () => {
    const doc = free([w('a', 'card')]);
    const r = changeWidgetType(doc, 'a', 'line');
    expect(r.rejected).toBe('unknown-widget');
    expect(r.doc).toBe(doc);
  });
});

describe('Sao chép / dán định dạng', () => {
  it('chép màu, kiểu nền, biểu tượng, ngưỡng; không chép nhãn và Tag', () => {
    const src = w('a', 'card', {
      props: { label: 'A', fill: 'solid', accent: 'teal', icon: 'pump', warnAbove: 5 },
      tags: { value: 'X' },
    });
    const clip = copyFormat(src)!;
    expect(clip).toEqual({ fill: 'solid', accent: 'teal', icon: 'pump', warnAbove: 5 });
    const doc = free([
      src,
      w('b', 'card', { props: { label: 'B' }, tags: { value: 'Y' } }),
      w('c', 'gauge'),
    ]);
    const r = pasteFormat(doc, ['b', 'c'], clip);
    expect((r.doc.items[1] as WidgetItem).props).toEqual({
      label: 'B',
      fill: 'solid',
      accent: 'teal',
      icon: 'pump',
      warnAbove: 5,
    });
    expect((r.doc.items[1] as WidgetItem).tags).toEqual({ value: 'Y' });
    // gauge không có fill/accent/icon/warnAbove: không đổi
    expect(r.doc.items[2]).toBe(doc.items[2]);
  });
  it('không có gì đổi thì trả tài liệu cũ; item khóa bỏ qua', () => {
    const doc = free([w('b', 'card', { locked: true })]);
    expect(pasteFormat(doc, ['b'], { accent: 'teal' }).doc).toBe(doc);
  });
});

describe('Nhiều Tag → hàng thẻ', () => {
  const grid = () =>
    ({ ...free([]), layout: { ...emptyGridLayout(), rows: [] } }) as unknown as ScreenModel;
  it('3 Tag: một hàng 3 ô 4 cột, cao 116; BOOL thành đèn; nhãn = mô tả', () => {
    const r = addTagRows(grid(), [
      { id: 'T1', type: 'FLOAT32', description: 'Nhiệt độ' },
      { id: 'T2', type: 'BOOL', description: 'Bơm chạy' },
      { id: 'T3', type: 'INT16' },
    ]);
    expect(r.rejected).toBeUndefined();
    const rows = (
      r.doc as unknown as {
        layout: { rows: Array<{ height: number; cells: Array<{ span: number }> }> };
      }
    ).layout.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.height).toBe(116);
    expect(rows[0]!.cells.map((c) => c.span)).toEqual([4, 4, 4]);
    const items = r.doc.items as WidgetItem[];
    expect(items.map((i) => i.widget)).toEqual(['card', 'multi-state', 'card']);
    expect(items.map((i) => i.props!['label'])).toEqual(['Nhiệt độ', 'Bơm chạy', 'T3']);
    expect(items[1]!.props!['shape']).toBe('lamp');
    expect(items.map((i) => i.tags)).toEqual([{ value: 'T1' }, { value: 'T2' }, { value: 'T3' }]);
    expect(r.selection).toEqual(items.map((i) => i.id));
  });
  it('8 Tag: hai hàng (6 + 2)', () => {
    const tags = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, type: 'FLOAT32' }));
    const r = addTagRows(grid(), tags);
    const rows = (r.doc as unknown as { layout: { rows: Array<{ cells: unknown[] }> } }).layout
      .rows;
    expect(rows.map((x) => x.cells.length)).toEqual([6, 2]);
  });
});
