// Gắn nhanh (feature 008, T092; FR-058): danh sách bộ phận của ký hiệu thư viện kèm gợi ý, đích mở của từng bộ phận và
// trạng thái nối của điểm gắn.
import type { BindingSet04, ScreenModel, SvgItem } from '@mat/project-schema';
import { getSymbol, symbolFiles } from '@mat/symbols';
import { describe, expect, it } from 'vitest';
import { portStatuses, quickParts, quickTarget } from './quick-bind.ts';
import { planSymbolDrop, symbolKey } from './symbol-flow.ts';

const screen: ScreenModel = {
  schemaVersion: '0.4.0',
  id: 'main',
  name: 'Chính',
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items: [],
};

function place(key: string, at: { x: number; y: number }, items: SvgItem[] = []): SvgItem {
  const plan = planSymbolDrop(key, at, {
    screen: { ...screen, items },
    graphicsFiles: [],
    schemaVersion: '0.4.0',
    grid: 0,
    snap: false,
    alt: false,
    zoom: 1,
  });
  if (!plan.ok) throw new Error('rejected');
  return plan.item;
}

const set = (elements: BindingSet04['elements']): BindingSet04 => ({
  schemaVersion: '0.4.0',
  screenId: 'main',
  itemId: 'x',
  elements,
});

describe('quickParts', () => {
  it('item không dùng tệp ký hiệu của thư viện: null', () => {
    const it = { ...place('pump-centrifugal', { x: 100, y: 100 }), svgFile: 'graphics/bom.svg' };
    expect(quickParts(it, undefined)).toBeNull();
  });

  it('liệt kê bộ phận theo manifest kèm nhãn và gợi ý', () => {
    const it = place('pump-centrifugal', { x: 100, y: 100 });
    const parts = quickParts(it, undefined)!;
    expect(parts.map((p) => p.role)).toEqual(
      getSymbol('pump-centrifugal')!.parts.map((p) => p.role),
    );
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
    const f = symbolFiles(getSymbol('pipe-elbow')!)[0]!;
    const it = place(symbolKey(f), { x: 100, y: 100 });
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

describe('portStatuses', () => {
  it('điểm gắn trùng khít điểm tương thích của item khác là đã nối', () => {
    const a = place('pipe-h', { x: 150, y: 110 });
    const b = { ...place('pipe-h', { x: 250, y: 110 }, [a]), x: a.x + a.width };
    b.y = a.y;
    const st = portStatuses(b, [a, b]);
    expect(st.find((p) => p.id === 'west')).toMatchObject({ dir: 'w', linkedTo: a.id });
    expect(st.find((p) => p.id === 'east')!.linkedTo).toBeNull();
  });

  it('item không phải ký hiệu: danh sách rỗng', () => {
    const it = { ...place('pipe-h', { x: 150, y: 110 }), svgFile: 'graphics/a.svg' };
    expect(portStatuses(it, [it])).toEqual([]);
  });
});
