// Bắt dính lưới và đường gióng (feature 007, T098; R20; SC-014).
import { describe, expect, it } from 'vitest';
import { snapBox, snapDrag, snapResizeDelta, type SnapOptions } from './snap.ts';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const screen = { width: 1280, height: 720 };
const A = r(200, 100, 100, 50); // trái 200, giữa 250, phải 300; trên 100, giữa 125, dưới 150
const opts = (extra: Partial<SnapOptions> = {}): SnapOptions => ({
  grid: 10,
  zoom: 1,
  snap: true,
  alt: false,
  others: [A],
  screen,
  ...extra,
});
const xs = (g: { axis: string; pos: number }[]) =>
  g.filter((q) => q.axis === 'x').map((q) => q.pos);

describe('snapBox: ứng viên item và màn hình', () => {
  it('dính cạnh trái vào cạnh trái item (Δ 3 ≤ 6)', () => {
    const s = snapBox(r(197, 300, 40, 20), opts());
    expect(s.x).toBe(200);
    expect(s.snapX).toBe('item');
    expect(xs(s.guides)).toEqual([200]);
  });
  it('trục không có ứng viên: dính lưới', () => {
    const s = snapBox(r(197, 303, 40, 20), opts());
    expect(s.y).toBe(300);
    expect(s.snapY).toBe('grid');
    expect(s.guides.filter((g) => g.axis === 'y')).toEqual([]);
  });
  it('dính cạnh phải và giữa của box vào ứng viên', () => {
    expect(snapBox(r(262, 300, 40, 20), opts()).x).toBe(260); // phải 302 → 300
    expect(snapBox(r(230, 300, 40, 20), opts()).x).toBe(230); // giữa 250 = giữa A
    expect(snapBox(r(231, 300, 40, 20), opts()).x).toBe(230);
  });
  it('trục y: trên/dưới/giữa của item', () => {
    const s = snapBox(r(600, 128, 40, 20), opts()); // dưới 148 → 150: y=130
    expect(s.y).toBe(130);
    expect(s.snapY).toBe('item');
    expect(s.guides.filter((g) => g.axis === 'y').map((g) => g.pos)).toEqual([150]);
  });
  it('hộp màn hình là ứng viên (cạnh trái, cạnh phải)', () => {
    const l = snapBox(r(3, 400, 40, 20), opts());
    expect(l.x).toBe(0);
    expect(l.guides.find((g) => g.axis === 'x')!.source).toBe('screen');
    expect(snapBox(r(1235, 400, 40, 20), opts()).x).toBe(1240);
  });
  it('chọn ứng viên gần nhất trên mỗi trục', () => {
    const o = opts({ others: [A, r(205, 500, 10, 10)] });
    expect(snapBox(r(203, 300, 40, 20), o).x).toBe(205);
  });
  it('ưu tiên gióng item hơn lưới', () => {
    const o = opts({ others: [r(203, 500, 10, 10)] });
    const s = snapBox(r(204, 300, 40, 20), o);
    expect(s.x).toBe(203);
    expect(s.snapX).toBe('item');
  });
  it('trả về mọi đường gióng trùng khớp sau khi dính', () => {
    const s = snapBox(r(198, 300, 100, 20), opts()); // trái→200; giữa 250, phải 300 cùng trùng A
    expect(s.x).toBe(200);
    expect(xs(s.guides).sort((p, q) => p - q)).toEqual([200, 250, 300]);
  });
});

describe('snapBox: ngưỡng 6 / zoom (bảng ca zoom)', () => {
  // một đường dọc duy nhất ở x = 203; box điểm (rộng 0) để chỉ có một cạnh tham gia
  const T = r(203, 500, 0, 10);
  const o = (zoom: number) => opts({ zoom, others: [T] });
  it('zoom 25 %: ngưỡng 24 đơn vị thiết kế', () => {
    expect(snapBox(r(185, 300, 0, 20), o(0.25))).toMatchObject({ x: 203, snapX: 'item' }); // Δ18
    expect(snapBox(r(227, 300, 0, 20), o(0.25))).toMatchObject({ x: 203, snapX: 'item' }); // Δ24
    expect(snapBox(r(228, 300, 0, 20), o(0.25))).toMatchObject({ x: 230, snapX: 'grid' }); // Δ25
  });
  it('zoom 100 %: ngưỡng 6', () => {
    expect(snapBox(r(201, 300, 0, 20), o(1))).toMatchObject({ x: 203, snapX: 'item' }); // Δ2
    expect(snapBox(r(197, 300, 0, 20), o(1))).toMatchObject({ x: 203, snapX: 'item' }); // Δ6
    expect(snapBox(r(196, 300, 0, 20), o(1))).toMatchObject({ x: 200, snapX: 'grid' }); // Δ7
  });
  it('zoom 400 %: ngưỡng 1,5', () => {
    expect(snapBox(r(201, 300, 0, 20), o(4))).toMatchObject({ x: 200, snapX: 'grid' }); // Δ2
    expect(snapBox(r(201.5, 300, 0, 20), o(4))).toMatchObject({ x: 203, snapX: 'item' }); // Δ1,5
  });
});

describe('snapBox: tắt bắt dính', () => {
  it('Alt: chỉ làm tròn về số nguyên, không đường gióng', () => {
    const s = snapBox(r(197.4, 303.6, 40, 20), opts({ alt: true }));
    expect(s).toMatchObject({ x: 197, y: 304, guides: [], snapX: 'none', snapY: 'none' });
  });
  it('snap=false tương đương', () => {
    expect(snapBox(r(197, 303, 40, 20), opts({ snap: false })).x).toBe(197);
  });
  it('grid=0: chỉ gióng item', () => {
    const s = snapBox(r(500, 303, 40, 20), opts({ grid: 0 }));
    expect(s.y).toBe(303);
    expect(s.snapY).toBe('none');
  });
});

describe('snapDrag: kéo nhiều item theo hộp bao', () => {
  const r1 = r(100, 100, 50, 50);
  const r2 = r(200, 150, 50, 50); // hộp bao 100,100 150×100
  const far = opts({ others: [r(400, 300, 100, 50)] });
  it('cạnh phải của hộp bao dính vào cạnh trái item khác', () => {
    expect(snapDrag([r1, r2], 147, 0, far)).toMatchObject({ dx: 150, dy: 0 });
    expect(snapDrag([r1, r2], 147.4, 0, far)).toMatchObject({ dx: 150, dy: 0 });
    expect(xs(snapDrag([r1, r2], 147, 0, far).guides)).toEqual([400]);
  });
  it('lưới theo vị trí hộp bao', () => {
    const none = opts({ others: [] });
    expect(snapDrag([r1, r2], 13, -7, none)).toMatchObject({ dx: 10, dy: -10 });
  });
  it('Alt: giữ nguyên chênh lệch (làm tròn)', () => {
    expect(snapDrag([r1, r2], 13.4, -7.4, opts({ alt: true, others: [] }))).toMatchObject({
      dx: 13,
      dy: -7,
    });
  });
});

describe('snapResizeDelta: chỉ cạnh đang kéo', () => {
  const box = r(100, 100, 100, 50);
  const o = opts({ others: [r(300, 400, 10, 10)] });
  it('cạnh phải dính ứng viên, dy giữ nguyên', () => {
    expect(snapResizeDelta(box, 'e', 96, 7, o)).toMatchObject({ dx: 100, dy: 7 });
  });
  it('cạnh trái và trên (góc nw) dính lưới', () => {
    expect(snapResizeDelta(box, 'nw', -7, -7, opts({ others: [] }))).toMatchObject({
      dx: -10,
      dy: -10,
    });
  });
  it('tay nắm s chỉ động tới dy', () => {
    expect(snapResizeDelta(box, 's', 13, 13, opts({ others: [] }))).toMatchObject({
      dx: 13,
      dy: 10,
    });
  });
  it('Alt: làm tròn', () => {
    expect(snapResizeDelta(box, 'se', 3.6, 4.4, opts({ alt: true }))).toMatchObject({
      dx: 4,
      dy: 4,
      guides: [],
    });
  });
});
