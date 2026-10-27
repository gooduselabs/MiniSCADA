// Gắn nhanh (feature 008, T092; FR-058): danh sách bộ phận của hình ký hiệu mẫu cũ kèm gợi ý và đích mở của từng bộ phận.
import type { BindingSet04, SvgItem } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { quickParts, quickTarget } from './quick-bind.ts';

/** Item `svg` dùng tệp `graphics/symbols/<key>.svg` (như project cũ đã chèn ký hiệu). */
function place(key: string, at: { x: number; y: number }): SvgItem {
  return {
    id: `svg_${key}`,
    type: 'svg',
    x: at.x,
    y: at.y,
    width: 100,
    height: 100,
    svgFile: `graphics/symbols/${key}.svg`,
    bindingFile: `screens/main.svg_${key}.bindings.json`,
  } as SvgItem;
}

const set = (elements: BindingSet04['elements']): BindingSet04 => ({
  schemaVersion: '0.4.0',
  screenId: 'main',
  itemId: 'x',
  elements,
});

describe('quickParts', () => {
  it('item không dùng tệp ký hiệu mẫu: null', () => {
    const it = { ...place('pump-centrifugal', { x: 100, y: 100 }), svgFile: 'graphics/bom.svg' };
    expect(quickParts(it, undefined)).toBeNull();
  });

  it('liệt kê bộ phận kèm nhãn và gợi ý', () => {
    const it = place('pump-centrifugal', { x: 100, y: 100 });
    const parts = quickParts(it, undefined)!;
    expect(parts.map((p) => p.role)).toEqual(['body', 'impeller', 'lamp', 'hit']);
    const lamp = parts.find((p) => p.role === 'lamp')!;
    expect(lamp.uid).toBe('el_pump_centrifugal_lamp');
    expect(lamp.label).toBe('Đèn trạng thái');
    expect(lamp.suggest).toEqual(['fill', 'blink']);
    expect(lamp.bound).toBe(0);
  });

  it('đếm binding và sự kiện đã có của từng bộ phận', () => {
    const it = place('pump-centrifugal', { x: 100, y: 100 });
    const s = set([
      {
        elementUid: 'el_pump_centrifugal_lamp',
        bindings: [
          {
            id: 'a',
            target: 'fill',
            source: { kind: 'tag', tagId: 'T' },
            transform: { kind: 'direct' },
          },
        ],
      },
      {
        elementUid: 'el_pump_centrifugal_hit',
        events: { click: { action: 'pulse', tag: 'T', value: true, durationMs: 300 } },
      },
    ] as unknown as BindingSet04['elements']);
    const parts = quickParts(it, s)!;
    expect(parts.find((p) => p.role === 'lamp')!.bound).toBe(1);
    expect(parts.find((p) => p.role === 'hit')!.hasEvent).toBe(true);
    expect(parts.find((p) => p.role === 'body')!.bound).toBe(0);
  });

  it('biến thể (cút) dùng bộ phận của ký hiệu', () => {
    const it = place('pipe-elbow-ws', { x: 100, y: 100 });
    expect(quickParts(it, undefined)!.map((p) => p.role)).toEqual(['pipe', 'flow']);
  });
});

describe('quickTarget', () => {
  const part = (role: string) =>
    quickParts(place('tank-vertical', { x: 100, y: 100 }), undefined)!.find(
      (p) => p.role === role,
    )!;

  it('mở dòng gợi ý đầu tiên của nhóm Gắn Tag', () => {
    expect(quickTarget(part('liquid'))).toEqual({ tab: 'bind', rowId: 'level', field: 'tag' });
    expect(quickTarget(part('text'))).toEqual({ tab: 'bind', rowId: 'text', field: 'tag' });
    expect(quickTarget(part('body'))).toEqual({ tab: 'bind', rowId: 'fill', field: 'tag' });
  });

  it('gợi ý click mở nhóm Sự kiện', () => {
    expect(quickTarget(part('hit'))).toEqual({ tab: 'events', field: 'action' });
  });

  it('không có gợi ý: mở nhóm Gắn Tag, không dòng cụ thể', () => {
    expect(
      quickTarget({
        uid: 'el_x_y',
        role: 'y',
        label: 'Y',
        suggest: [],
        bound: 0,
        hasEvent: false,
      }),
    ).toEqual({ tab: 'bind', field: 'tag' });
  });
});
