// Mô hình thả ký hiệu SVG (feature 008, T090; FR-057; contract symbol-library §5, §6).
import { LIMITS_04, type ScreenModel, type SvgItem } from '@mat/project-schema';
import { SYMBOLS, getSymbol, getSymbolSvg, symbolFiles } from '@mat/symbols';
import { describe, expect, it } from 'vitest';
import {
  SYMBOL_DIR,
  fixedPortsOf,
  planSymbolDrop,
  symbolFileOf,
  symbolKey,
  symbolTarget,
  type SymbolDropTarget,
} from './symbol-flow.ts';

const screen = (items: SvgItem[] = [], schema = '0.4.0'): ScreenModel => ({
  schemaVersion: schema,
  id: 'main',
  name: 'Chính',
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items,
});

const target = (over: Partial<SymbolDropTarget> = {}): SymbolDropTarget => ({
  screen: screen(),
  graphicsFiles: [],
  schemaVersion: '0.4.0',
  grid: 10,
  snap: true,
  alt: false,
  zoom: 1,
  ...over,
});

const pump = symbolFiles(getSymbol('pump-centrifugal')!)[0]!;
const pipeH = symbolFiles(getSymbol('pipe-h')!)[0]!;

describe('planSymbolDrop', () => {
  it('thả bơm: item svg cỡ defaultSize, tệp sao vào graphics/symbols, file binding riêng rỗng', () => {
    const plan = planSymbolDrop(symbolKey(pump), { x: 200, y: 200 }, target());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const it = plan.item;
    expect(it.type).toBe('svg');
    expect(it.id).toBe('pump_centrifugal_1');
    expect(it.width).toBe(120);
    expect(it.height).toBe(120);
    expect(it.viewBox).toEqual([0, 0, 100, 100]);
    expect(it.fit).toBe('contain');
    expect(it.name).toBe('Bơm ly tâm');
    expect(it.svgFile).toBe(`${SYMBOL_DIR}pump-centrifugal.svg`);
    expect(it.bindingFile).toBe('screens/main.pump_centrifugal_1.bindings.json');
    expect(plan.change.replace?.[it.svgFile]).toBe(getSymbolSvg('svg/pump-centrifugal.svg'));
    const kinds = plan.change.edits?.map((e) => e.kind);
    expect(kinds).toEqual(['screenUpsert', 'svgBindings']);
    const b = plan.change.edits?.[1];
    expect(b && b.kind === 'svgBindings' ? b.set : null).toEqual({
      schemaVersion: '0.4.0',
      screenId: 'main',
      itemId: 'pump_centrifugal_1',
      elements: [],
    });
  });

  it('elements liệt kê các bộ phận (uid, tên nhãn)', () => {
    const plan = planSymbolDrop(symbolKey(pump), { x: 0, y: 0 }, target());
    if (!plan.ok) throw new Error('rejected');
    expect(plan.item.elements).toEqual(
      getSymbol('pump-centrifugal')!.parts.map((p) => ({ elementUid: p.uid, name: p.label })),
    );
  });

  it('đặt tâm ký hiệu ở điểm thả và dính lưới', () => {
    const plan = planSymbolDrop(symbolKey(pump), { x: 203, y: 197 }, target());
    if (!plan.ok) throw new Error('rejected');
    expect([plan.item.x, plan.item.y]).toEqual([140, 140]);
  });

  it('Alt tắt dính lưới: chỉ làm tròn', () => {
    const plan = planSymbolDrop(symbolKey(pump), { x: 203, y: 197 }, target({ alt: true }));
    if (!plan.ok) throw new Error('rejected');
    expect([plan.item.x, plan.item.y]).toEqual([143, 137]);
  });

  it('nhiều thể hiện dùng chung một tệp: tệp đã có thì không sao lại; id không trùng', () => {
    const first = planSymbolDrop(symbolKey(pump), { x: 100, y: 100 }, target());
    if (!first.ok) throw new Error('rejected');
    const t2 = target({
      screen: screen([first.item]),
      graphicsFiles: [first.svgFile, first.bindingFile],
    });
    const second = planSymbolDrop(symbolKey(pump), { x: 600, y: 100 }, t2);
    if (!second.ok) throw new Error('rejected');
    expect(second.item.id).toBe('pump_centrifugal_2');
    expect(second.item.svgFile).toBe(first.item.svgFile);
    expect(second.change.replace).toBeUndefined();
    expect(second.item.bindingFile).not.toBe(first.item.bindingFile);
  });

  it('id không quá 32 ký tự với mọi tệp ký hiệu, kể cả số thứ tự hai chữ số', () => {
    const used: SvgItem[] = [];
    for (const s of SYMBOLS)
      for (const f of symbolFiles(s)) {
        const plan = planSymbolDrop(symbolKey(f), { x: 50, y: 50 }, target());
        if (!plan.ok) throw new Error(`rejected ${f.file}`);
        expect(plan.item.id.length).toBeLessThanOrEqual(32);
        expect(plan.item.id).toMatch(/^[a-z][a-z0-9_]*_1$/);
        expect(plan.item.elements.length).toBe(s.parts.length);
        used.push(plan.item);
      }
    expect(used.length).toBe(15);
  });

  it('item thứ 65 bị từ chối max-svg-items (trần 64 của 0.4), 0.3 thì trần 8', () => {
    const base = planSymbolDrop(symbolKey(pipeH), { x: 0, y: 0 }, target());
    if (!base.ok) throw new Error('rejected');
    const many = (n: number): SvgItem[] =>
      Array.from({ length: n }, (_, i) => ({ ...base.item, id: `p_${i + 1}` }));
    const ok = planSymbolDrop(
      symbolKey(pipeH),
      { x: 0, y: 0 },
      target({ screen: screen(many(LIMITS_04.svgItems - 1)) }),
    );
    expect(ok.ok).toBe(true);
    const bad = planSymbolDrop(
      symbolKey(pipeH),
      { x: 0, y: 0 },
      target({ screen: screen(many(LIMITS_04.svgItems)) }),
    );
    expect(bad).toEqual({ ok: false, reason: 'max-svg-items' });
    const old = planSymbolDrop(
      symbolKey(pipeH),
      { x: 0, y: 0 },
      target({ screen: screen(many(8), '0.3.0'), schemaVersion: '0.3.0' }),
    );
    expect(old).toEqual({ ok: false, reason: 'max-svg-items' });
  });

  it('khóa không có trong thư viện bị từ chối unknown-symbol', () => {
    expect(planSymbolDrop('svg/khong-co.svg', { x: 0, y: 0 }, target())).toEqual({
      ok: false,
      reason: 'unknown-symbol',
    });
  });
});

describe('dính điểm gắn khi thả', () => {
  const placed = (): { item: SvgItem; t: SymbolDropTarget } => {
    // Ống ngang A tại (100,100) cỡ 100 × 20: điểm east ở (200, 110).
    const a = planSymbolDrop(symbolKey(pipeH), { x: 150, y: 110 }, target());
    if (!a.ok) throw new Error('rejected');
    const item = { ...a.item, x: 100, y: 100 };
    return { item, t: target({ screen: screen([item]), graphicsFiles: [item.svgFile] }) };
  };

  it('fixedPortsOf: đổi điểm gắn tương đối của ký hiệu có trong thư viện sang đơn vị thiết kế', () => {
    const { item } = placed();
    const ports = fixedPortsOf([item]);
    const east = ports.find((p) => p.portId === 'east')!;
    expect([east.x, east.y, east.dir, east.itemId]).toEqual([200, 110, 'e', item.id]);
  });

  it('thả ống B gần điểm east của A: dính, west của B trùng east của A', () => {
    const { t } = placed();
    // B tâm (253, 112): góc trái trên thô (203, 102), west ở (203, 112) cách east của A 3 đơn vị.
    const plan = planSymbolDrop(symbolKey(pipeH), { x: 253, y: 112 }, t);
    if (!plan.ok) throw new Error('rejected');
    expect([plan.item.x, plan.item.y]).toEqual([200, 100]);
    expect(plan.portSnap?.pair[0].portId).toBe('west');
    expect(plan.portSnap?.pair[1].portId).toBe('east');
  });

  it('dính điểm gắn thắng dính lưới (lưới 30 kéo về 210 và 90, điểm gắn về 200 và 100)', () => {
    const { t } = placed();
    const plan = planSymbolDrop(symbolKey(pipeH), { x: 253, y: 112 }, { ...t, grid: 30 });
    if (!plan.ok) throw new Error('rejected');
    expect([plan.item.x, plan.item.y]).toEqual([200, 100]);
    expect(plan.portSnap).toBeDefined();
  });

  it('Alt tắt dính điểm gắn', () => {
    const { t } = placed();
    const plan = planSymbolDrop(symbolKey(pipeH), { x: 253, y: 112 }, { ...t, alt: true });
    if (!plan.ok) throw new Error('rejected');
    expect(plan.portSnap).toBeUndefined();
    expect([plan.item.x, plan.item.y]).toEqual([203, 102]);
  });

  it('ngoài ngưỡng 10 px thì không dính; zoom 400 % thu ngưỡng về 2,5 đơn vị thiết kế', () => {
    const { t } = placed();
    const far = planSymbolDrop(symbolKey(pipeH), { x: 273, y: 112 }, t);
    if (!far.ok) throw new Error('rejected');
    expect(far.portSnap).toBeUndefined();
    const zoomed = planSymbolDrop(symbolKey(pipeH), { x: 253, y: 112 }, { ...t, zoom: 4 });
    if (!zoomed.ok) throw new Error('rejected');
    expect(zoomed.portSnap).toBeUndefined();
  });

  it('hai điểm cùng hướng không dính (bơm in west với ống west)', () => {
    const { t } = placed();
    // Thả ống ngang sao cho west của nó gần west của A (100,110): cùng hướng, không dính.
    const plan = planSymbolDrop(symbolKey(pipeH), { x: 152, y: 111 }, t);
    if (!plan.ok) throw new Error('rejected');
    expect(plan.portSnap).toBeUndefined();
  });
});

describe('symbolTarget và khóa', () => {
  it('symbolFileOf tra ngược item theo tệp trong graphics/symbols; tệp nhập riêng trùng tên thì không khớp', () => {
    const plan = planSymbolDrop(symbolKey(pump), { x: 0, y: 0 }, target());
    if (!plan.ok) throw new Error('rejected');
    expect(symbolFileOf(plan.item)?.symbol.id).toBe('pump-centrifugal');
    expect(
      symbolFileOf({ ...plan.item, svgFile: 'graphics/pump-centrifugal.svg' }),
    ).toBeUndefined();
  });

  it('symbolTarget lấy file, phiên bản và màn hình', () => {
    const tg = symbolTarget(screen(), ['graphics/a.svg'], '0.4.0', {
      grid: 10,
      snap: true,
      alt: false,
      zoom: 2,
    });
    expect(tg.zoom).toBe(2);
    expect([...tg.graphicsFiles]).toEqual(['graphics/a.svg']);
  });
});
