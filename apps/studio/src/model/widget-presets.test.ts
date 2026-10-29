// Feature 037: component mới thả vào có giá trị khởi đầu đẹp ngay (ô lưới và canvas tự do).
import { catalogWidget, checkPropValue } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { TOOL_VARIANTS, WIDGET_PRESETS, baseWidget, presetProps } from './widget-presets.ts';

describe('WIDGET_PRESETS', () => {
  it('mọi giá trị khởi đầu là thuộc tính hợp lệ của danh mục', () => {
    for (const [w, props] of Object.entries(WIDGET_PRESETS)) {
      const spec = catalogWidget(w);
      expect(spec, w).toBeDefined();
      for (const [k, v] of Object.entries(props)) {
        const p = spec!.props.find((x) => x.name === k);
        expect(p, `${w}.${k}`).toBeDefined();
        expect(checkPropValue(p!, presetProps(w)![k]), `${w}.${k}`).toBeNull();
        void v;
      }
    }
  });
  it('bản sao sâu; loại không có thì undefined', () => {
    const a = presetProps('multi-state')!;
    (a['states'] as unknown[]).pop();
    expect((WIDGET_PRESETS['multi-state']!['states'] as unknown[]).length).toBe(3);
    expect((presetProps('multi-state')!['states'] as Array<{ text: string }>)[1]!.text).toBe(
      'Chạy',
    );
    expect(presetProps('gauge')).toBeUndefined();
  });
  it('attachWidget gắn giá trị khởi đầu', async () => {
    const { attachWidget, emptyGridLayout } = await import('./grid-ops.ts');
    const l = emptyGridLayout();
    const doc = {
      schemaVersion: '1.1.0',
      id: 's',
      name: 'S',
      kind: 'screen',
      size: { width: 1280, height: 720 },
      items: [],
      layout: l,
    } as never;
    const cell = l.rows[0]!.cells[0]!.id;
    const r = attachWidget(doc, cell, 'level');
    expect((r.doc.items[0] as { props?: object }).props).toEqual({
      label: 'Mức bồn',
      style: 'tank',
      wave: true,
    });
  });
  it('041: bảng alarm: ô rộng (≥ 8 cột) kiểu Đầy đủ, ô hẹp kiểu Gọn (không ghi mode); mục Lịch sử alarm là preset', async () => {
    const { attachWidget, emptyGridLayout } = await import('./grid-ops.ts');
    const mk = (span: number) => {
      const l = emptyGridLayout();
      l.rows[0]!.cells[0]!.span = span;
      return {
        doc: {
          schemaVersion: '1.1.0',
          id: 's',
          name: 'S',
          kind: 'screen',
          size: { width: 1280, height: 720 },
          items: [],
          layout: l,
        } as never,
        cell: l.rows[0]!.cells[0]!.id,
      };
    };
    const wide = mk(12);
    expect(
      (attachWidget(wide.doc, wide.cell, 'alarm-list').doc.items[0] as { props?: object }).props,
    ).toEqual({ mode: 'full' });
    const narrow = mk(4);
    expect(
      (attachWidget(narrow.doc, narrow.cell, 'alarm-list').doc.items[0] as { props?: object })
        .props,
    ).toEqual({});
    const h = mk(12);
    const it = attachWidget(h.doc, h.cell, 'alarm-list~history').doc.items[0] as {
      widget: string;
      props?: object;
    };
    expect(it.widget).toBe('alarm-list');
    expect(it.props).toEqual({ mode: 'full', source: 'history' });
    expect(baseWidget('alarm-list~history')).toBe('alarm-list');
    const spec = catalogWidget('alarm-list')!;
    for (const [k, v] of Object.entries(TOOL_VARIANTS['alarm-list~history']!.props))
      expect(
        checkPropValue(
          spec.props.find((x) => x.name === k)!,
          v,
        ),
      ).toBeNull();
  });
});
