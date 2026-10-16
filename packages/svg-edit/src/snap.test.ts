// T152 (SC-031; FR-103): bắt dính 4 loại (lưới, cạnh/tâm, điểm, góc 15°) và thứ tự ưu tiên (điểm > cạnh/tâm > lưới;
// hòa thì gần hơn, rồi NodeId tăng); ngưỡng 6 điểm ảnh màn hình = 6 / zoom đơn vị tài liệu.
import { describe, expect, it } from 'vitest';
import { snapMove, snapPoint, type SnapConfig } from './snap.ts';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
const base: SnapConfig = {
  zoom: 1,
  grid: 10,
  objects: [
    { id: 5, box: box(100, 100, 50, 20) },
    { id: 3, box: box(300, 40, 10, 10) },
  ],
  points: [{ id: 7, x: 203, y: 207 }],
};

describe('snapPoint', () => {
  it.each<
    [
      string,
      [number, number],
      Partial<SnapConfig>,
      [number, number],
      string | undefined,
      string | undefined,
    ]
  >([
    ['lưới', [12, 27], {}, [10, 30], 'grid', 'grid'],
    ['lưới 25', [12, 27], { grid: 25 }, [0, 25], 'grid', 'grid'],
    ['tắt lưới', [12, 27], { grid: null }, [12, 27], undefined, undefined],
    ['cạnh trái trong ngưỡng', [103, 57], {}, [100, 60], 'edge', 'grid'],
    ['tâm ngang', [124, 57], {}, [125, 60], 'center', 'grid'],
    ['cạnh phải', [146, 57], {}, [150, 60], 'edge', 'grid'],
    ['cạnh trên và dưới', [61, 118], {}, [60, 120], 'grid', 'edge'],
    ['ngoài ngưỡng 6: về lưới', [93, 57], {}, [90, 60], 'grid', 'grid'],
    ['điểm thắng cạnh/tâm và lưới', [201, 205], {}, [203, 207], 'point', 'point'],
    ['điểm ngoài ngưỡng (khoảng cách Euclid)', [198, 202], {}, [200, 200], 'grid', 'grid'],
    ['zoom 2: ngưỡng 3 đơn vị', [104, 57], { zoom: 2 }, [100, 60], 'grid', 'grid'],
    ['zoom 0,5: ngưỡng 12 đơn vị', [111, 57], { zoom: 0.5 }, [100, 50], 'edge', 'edge'],
  ])('%s', (_l, p, over, want, kx, ky) => {
    const r = snapPoint({ x: p[0], y: p[1] }, { ...base, ...over });
    expect(r.x).toBeCloseTo(want[0], 6);
    expect(r.y).toBeCloseTo(want[1], 6);
    expect(r.kindX).toBe(kx);
    expect(r.kindY).toBe(ky);
  });

  it('hai cạnh cùng ngưỡng: gần hơn thắng', () => {
    const r = snapPoint(
      { x: 102, y: 0 },
      {
        zoom: 1,
        grid: null,
        objects: [
          { id: 1, box: box(97, 500, 1, 1) },
          { id: 2, box: box(104, 500, 1, 1) },
        ],
      },
    );
    expect(r.x).toBe(104); // |102-104| = 2 < |102-98| = 4 (cạnh phải của id 1 là 98)
  });

  it('hòa khoảng cách: NodeId nhỏ hơn thắng', () => {
    const r = snapPoint(
      { x: 102, y: 0 },
      {
        zoom: 1,
        grid: null,
        objects: [
          { id: 9, box: box(104, 500, 1, 1) },
          { id: 2, box: box(99, 500, 1, 1) },
        ],
      },
    );
    expect(r.x).toBe(100); // id 2: cạnh phải 100 (cách 2); id 9: cạnh trái 104 (cách 2)
    expect(r.guides.find((g) => g.axis === 'x')!.targetId).toBe(2);
  });

  it('đường gióng cho cạnh và điểm', () => {
    const r = snapPoint({ x: 101, y: 300 }, { zoom: 1, grid: null, objects: base.objects });
    expect(r.guides).toEqual([{ axis: 'x', pos: 100, kind: 'edge', targetId: 5 }]);
    const q = snapPoint({ x: 204, y: 206 }, base);
    expect(q.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it.each<[number, number, number]>([
    [10, 1, 0],
    [10, 3, 15],
    [10, 10, 45],
    [-10, 1, 180],
    [0, -10, 270],
    [10, 5, 30],
  ])('góc 15° (Shift) quanh điểm neo: (%s, %s) → %s°', (dx, dy, deg) => {
    const r = snapPoint(
      { x: 50 + dx, y: 50 + dy },
      { zoom: 1, grid: 10, angle: { anchor: { x: 50, y: 50 } } },
    );
    const a = (Math.atan2(r.y - 50, r.x - 50) * 180) / Math.PI;
    expect(((a % 360) + 360) % 360).toBeCloseTo(deg, 6);
    // giữ độ dài hình chiếu lên hướng đã bắt
    expect(r.kindX).toBe('angle');
  });
});

describe('snapMove (kéo hộp)', () => {
  const moving = box(0, 0, 20, 10);
  it.each<[string, [number, number], Partial<SnapConfig>, [number, number]]>([
    ['lưới theo cạnh trái/trên', [13, 22], {}, [10, 20]],
    ['cạnh trái vào cạnh trái đích', [98, 300], { grid: null }, [100, 300]],
    ['cạnh phải vào cạnh trái đích', [78, 300], { grid: null }, [80, 300]],
    ['tâm vào tâm', [114, 300], { grid: null }, [115, 300]],
    ['cạnh dưới vào cạnh trên đích', [500, 88], { grid: null }, [500, 90]],
    ['góc vào điểm (ưu tiên điểm)', [182, 196], {}, [183, 197]],
    ['không có gì trong ngưỡng, không lưới: giữ nguyên', [500, 500], { grid: null }, [500, 500]],
  ])('%s', (_l, d, over, want) => {
    const r = snapMove(moving, d[0], d[1], { ...base, ...over });
    expect(r.dx).toBeCloseTo(want[0], 6);
    expect(r.dy).toBeCloseTo(want[1], 6);
  });
});
