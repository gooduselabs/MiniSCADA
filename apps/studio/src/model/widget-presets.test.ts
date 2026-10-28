// Feature 037: component mới thả vào có giá trị khởi đầu đẹp ngay (ô lưới và canvas tự do).
import { catalogWidget, checkPropValue } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { WIDGET_PRESETS, presetProps } from './widget-presets.ts';

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
    });
  });
});
