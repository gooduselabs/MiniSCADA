// T152 (SC-031; FR-104): căn chỉnh 6 kiểu (theo hộp chung hoặc phần tử đầu), phân bố đều, cùng rộng/cao; trên tài
// liệu: đúng trong hệ tài liệu cả khi các phần tử nằm trong nhóm có transform khác nhau.
import { describe, expect, it } from 'vitest';
import {
  alignBoxes,
  alignNodes,
  distribute,
  distributeNodes,
  sameSize,
  sameSizeNodes,
  type AlignMode,
} from './align.ts';
import { bbox } from './bbox.ts';
import { applyCommand } from './command.ts';
import { body, byId } from './test-helpers.ts';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
const items = [
  { id: 1, box: box(10, 10, 20, 10) },
  { id: 2, box: box(50, 30, 10, 40) },
  { id: 3, box: box(0, 60, 30, 5) },
];

describe('alignBoxes', () => {
  it.each<[AlignMode, Array<[number, number]>]>([
    [
      'left',
      [
        [-10, 0],
        [-50, 0],
        [0, 0],
      ],
    ],
    [
      'right',
      [
        [30, 0],
        [0, 0],
        [30, 0],
      ],
    ],
    [
      'centerH',
      [
        [10, 0],
        [-25, 0],
        [15, 0],
      ],
    ],
    [
      'top',
      [
        [0, 0],
        [0, -20],
        [0, -50],
      ],
    ],
    [
      'bottom',
      [
        [0, 50],
        [0, 0],
        [0, 5],
      ],
    ],
    [
      'centerV',
      [
        [0, 25],
        [0, -10],
        [0, -22.5],
      ],
    ],
  ])('theo hộp chung: %s', (mode, want) => {
    expect(alignBoxes(items, mode).map((d) => [d.dx, d.dy])).toEqual(want);
  });

  it.each<[AlignMode, Array<[number, number]>]>([
    [
      'left',
      [
        [0, 0],
        [-40, 0],
        [10, 0],
      ],
    ],
    [
      'bottom',
      [
        [0, 0],
        [0, -50],
        [0, -45],
      ],
    ],
  ])('theo phần tử đầu (Alt): %s', (mode, want) => {
    expect(alignBoxes(items, mode, 'first').map((d) => [d.dx, d.dy])).toEqual(want);
  });
});

describe('distribute', () => {
  it('ngang: khoảng trống đều, hai đầu giữ', () => {
    const r = distribute(
      [
        { id: 1, box: box(0, 0, 10, 10) },
        { id: 2, box: box(15, 0, 20, 10) },
        { id: 3, box: box(90, 0, 10, 10) },
      ],
      'h',
    );
    // tổng 100, tổng rộng 40, 2 khoảng = 30 mỗi khoảng: id 2 về x = 40
    expect(r.map((d) => d.dx)).toEqual([0, 25, 0]);
  });
  it('dọc, thứ tự theo vị trí không theo id', () => {
    const r = distribute(
      [
        { id: 1, box: box(0, 100, 10, 10) },
        { id: 2, box: box(0, 0, 10, 10) },
        { id: 3, box: box(0, 20, 10, 10) },
        { id: 4, box: box(0, 70, 10, 30) },
      ],
      'v',
    );
    // thứ tự 2 (0), 3 (20), 4 (70), 1 (100); tổng 110, rộng 60, khoảng 50/3
    const g = 50 / 3;
    expect(r.find((d) => d.id === 3)!.dy).toBeCloseTo(10 + g - 20, 9);
    expect(r.find((d) => d.id === 4)!.dy).toBeCloseTo(10 + g + 10 + g - 70, 9);
    expect(r.find((d) => d.id === 1)!.dy).toBe(0);
  });
  it('dưới 3 phần tử: không làm gì', () => {
    expect(distribute(items.slice(0, 2), 'h')).toEqual([]);
  });
});

describe('sameSize (nút tham chiếu = chọn đầu)', () => {
  it.each<['width' | 'height' | 'both', Array<[number, number]>]>([
    [
      'width',
      [
        [1, 1],
        [2, 1],
        [2 / 3, 1],
      ],
    ],
    [
      'height',
      [
        [1, 1],
        [1, 0.25],
        [1, 2],
      ],
    ],
    [
      'both',
      [
        [1, 1],
        [2, 0.25],
        [2 / 3, 2],
      ],
    ],
  ])('%s', (dim, want) => {
    const r = sameSize(items, dim);
    r.forEach((d, i) => {
      expect(d.sx).toBeCloseTo(want[i][0], 9);
      expect(d.sy).toBeCloseTo(want[i][1], 9);
      expect([d.ox, d.oy]).toEqual([items[i].box.x, items[i].box.y]);
    });
  });
});

describe('trên tài liệu, phần tử khác nhóm có transform', () => {
  const doc0 = () =>
    body(
      '<g transform="translate(100 0) scale(2)"><rect id="a" x="0" y="0" width="10" height="5"/></g>' +
        '<g transform="rotate(90)"><rect id="b" x="10" y="-60" width="10" height="20"/></g>' +
        '<path id="c" d="M5 5 L25 35"/>',
    );
  it.each<AlignMode>(['left', 'right', 'centerH', 'top', 'bottom', 'centerV'])(
    '%s: hộp bao trong hệ tài liệu thẳng hàng',
    (mode) => {
      const doc = doc0();
      const ids = ['a', 'b', 'c'].map((i) => byId(doc, i));
      applyCommand(doc, alignNodes(doc, ids, mode));
      const bs = ids.map((i) => bbox(doc, i)!);
      const key = (b: { x: number; y: number; width: number; height: number }) =>
        mode === 'left'
          ? b.x
          : mode === 'right'
            ? b.x + b.width
            : mode === 'centerH'
              ? b.x + b.width / 2
              : mode === 'top'
                ? b.y
                : mode === 'bottom'
                  ? b.y + b.height
                  : b.y + b.height / 2;
      for (const b of bs) expect(key(b)).toBeCloseTo(key(bs[0]), 3);
    },
  );

  it('phân bố ngang trên tài liệu', () => {
    const doc = doc0();
    const ids = ['a', 'b', 'c'].map((i) => byId(doc, i));
    applyCommand(doc, distributeNodes(doc, ids, 'h'));
    const bs = ids.map((i) => bbox(doc, i)!).sort((p, q) => p.x - q.x);
    expect(bs[1].x - (bs[0].x + bs[0].width)).toBeCloseTo(bs[2].x - (bs[1].x + bs[1].width), 3);
  });

  it('cùng cao trên tài liệu', () => {
    const doc = doc0();
    const ids = ['a', 'b', 'c'].map((i) => byId(doc, i));
    applyCommand(doc, sameSizeNodes(doc, [ids[2], ids[0], ids[1]], 'height'));
    // tham chiếu là c (cao 30)
    for (const i of ids) expect(bbox(doc, i)!.height).toBeCloseTo(30, 3);
  });
});
