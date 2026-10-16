// T079 (phần plot): hàm thuần dựng dữ liệu cho uPlot: ghép trục thời gian, NaN tại khoảng đứt, bậc thang,
// vùng min–max, vạch chia trục theo giờ địa phương của nhóm, phóng/dịch, quy đổi tọa độ.
import { describe, expect, it } from 'vitest';
import {
  alignSeries,
  nearestIndex,
  niceTimeSplits,
  pxToTime,
  timeToPx,
  zoomRange,
  panRange,
  tzOffsetMs,
} from './history-plot.ts';

const line = (tagId: string, t: number[], v: (number | null)[], extra: object = {}) => ({
  tagId,
  t,
  v,
  ...extra,
});

describe('alignSeries', () => {
  it('một đường: giữ nguyên điểm, không NaN', () => {
    const r = alignSeries([line('A', [0, 10, 20], [1, 2, 3])], [], { step: [false] });
    expect([...r.x]).toEqual([0, 10, 20]);
    expect([...r.y[0]!]).toEqual([1, 2, 3]);
  });

  it('ô null thành NaN (đứt), không nối qua', () => {
    const r = alignSeries([line('A', [0, 10, 20, 30], [1, null, 3, 4])], [], { step: [false] });
    expect(Number.isNaN(r.y[0]![1]!)).toBe(true);
    expect(r.y[0]![2]).toBe(3);
  });

  it('hai đường lệch thời gian: nội suy tuyến tính cho đường thường', () => {
    const r = alignSeries([line('A', [0, 20], [0, 20]), line('B', [10], [5])], [], {
      step: [false, false],
    });
    expect([...r.x]).toEqual([0, 10, 20]);
    expect([...r.y[0]!]).toEqual([0, 10, 20]);
    expect(Number.isNaN(r.y[1]![0]!)).toBe(true); // trước điểm đầu của B
    expect(r.y[1]![1]).toBe(5);
    expect(Number.isNaN(r.y[1]![2]!)).toBe(true); // sau điểm cuối: không kéo dài
  });

  it('đường bậc thang giữ giá trị trước đó tới điểm kế', () => {
    const r = alignSeries([line('S', [0, 20], [1, 5]), line('X', [10], [0])], [], {
      step: [true, false],
    });
    expect([...r.y[0]!]).toEqual([1, 1, 5]);
  });

  it('khoảng đứt [a,b): chèn x tại a và b, giá trị trong khoảng là NaN, bậc thang không giữ qua khoảng', () => {
    const r = alignSeries([line('S', [0, 100], [7, 9])], [[40, 60]], { step: [true] });
    expect([...r.x]).toEqual([0, 40, 60, 100]);
    expect(r.y[0]![0]).toBe(7);
    expect(Number.isNaN(r.y[0]![1]!)).toBe(true);
    expect(Number.isNaN(r.y[0]![2]!)).toBe(true);
    expect(r.y[0]![3]).toBe(9);
  });

  it('khoảng đứt chặn nội suy tuyến tính', () => {
    const r = alignSeries([line('A', [0, 100], [0, 100])], [[40, 60]], { step: [false] });
    expect(Number.isNaN(r.y[0]![1]!)).toBe(true);
    expect(Number.isNaN(r.y[0]![2]!)).toBe(true);
  });

  it('khoảng đứt ngoài phạm vi dữ liệu không thêm x', () => {
    const r = alignSeries(
      [line('A', [10, 20], [1, 2])],
      [
        [100, 200],
        [0, 5],
      ],
      { step: [false] },
    );
    expect([...r.x]).toEqual([10, 20]);
  });

  it('vùng min–max được căn cùng trục; vắng thì null', () => {
    const r = alignSeries(
      [line('A', [0, 10], [5, 6], { min: [4, 5], max: [6, 7] }), line('B', [0, 10], [1, 2])],
      [],
      { step: [false, false] },
    );
    expect([...r.lo[0]!]).toEqual([4, 5]);
    expect([...r.hi[0]!]).toEqual([6, 7]);
    expect(r.lo[1]).toBeNull();
    expect(r.hi[1]).toBeNull();
  });

  it('không có dữ liệu: mảng rỗng', () => {
    const r = alignSeries([], [], { step: [] });
    expect(r.x.length).toBe(0);
    expect(r.y.length).toBe(0);
  });
});

describe('nearestIndex', () => {
  const x = Float64Array.from([0, 10, 20, 40]);
  it('chọn điểm gần nhất, hòa thì điểm trước', () => {
    expect(nearestIndex(x, -5)).toBe(0);
    expect(nearestIndex(x, 4)).toBe(0);
    expect(nearestIndex(x, 5)).toBe(0);
    expect(nearestIndex(x, 6)).toBe(1);
    expect(nearestIndex(x, 31)).toBe(3);
    expect(nearestIndex(x, 999)).toBe(3);
  });
  it('rỗng trả -1', () => {
    expect(nearestIndex(new Float64Array(0), 1)).toBe(-1);
  });
});

describe('niceTimeSplits', () => {
  const H = 3_600_000;
  it('vạch chia rơi vào bội số của bước theo giờ ĐỊA PHƯƠNG (+07:00)', () => {
    const off = 7 * H;
    // từ 00:00 đến 24:00 địa phương = UTC 17:00 hôm trước đến 17:00
    const from = 1_790_000_000_000 - (1_790_000_000_000 % (24 * H)) - 7 * H;
    const s = niceTimeSplits(from, from + 24 * H, off, 8);
    expect(s.length).toBeGreaterThanOrEqual(4);
    for (const t of s) expect((t + off) % (3 * H)).toBe(0); // bước 3 giờ
    expect(s[0]).toBeGreaterThanOrEqual(from);
    expect(s[s.length - 1]).toBeLessThanOrEqual(from + 24 * H);
  });
  it('múi giờ +05:30 căn theo nửa giờ', () => {
    const off = 5.5 * H;
    const s = niceTimeSplits(0, 2 * H, off, 8);
    for (const t of s) expect((t + off) % (15 * 60_000)).toBe(0);
  });
  it('khoảng quá hẹp hoặc bằng 0 trả mảng rỗng', () => {
    expect(niceTimeSplits(10, 10, 0, 8)).toEqual([]);
  });
});

describe('tzOffsetMs', () => {
  it('đọc ±HH:MM', () => {
    expect(tzOffsetMs('+07:00')).toBe(25_200_000);
    expect(tzOffsetMs('-03:30')).toBe(-12_600_000);
    expect(tzOffsetMs('xx')).toBe(0);
  });
});

describe('phóng và dịch', () => {
  it('zoomRange quanh con trỏ giữ nguyên điểm neo', () => {
    const r = zoomRange({ from: 0, to: 10000 }, 2500, 0.75);
    expect(r.to - r.from).toBeCloseTo(7500);
    // neo ở 25 % của khoảng trước và sau
    expect((2500 - r.from) / (r.to - r.from)).toBeCloseTo(0.25);
  });
  it('zoom ra với hệ số 1,25 làm khoảng rộng hơn 25 %', () => {
    const r = zoomRange({ from: 0, to: 10000 }, 5000, 1.25);
    expect(r.to - r.from).toBeCloseTo(12500);
  });
  it('khoảng tối thiểu 1 s', () => {
    const r = zoomRange({ from: 0, to: 1500 }, 0, 0.1);
    expect(r.to - r.from).toBeGreaterThanOrEqual(1000);
  });
  it('panRange dịch cả khoảng', () => {
    expect(panRange({ from: 100, to: 200 }, -30)).toEqual({ from: 70, to: 170 });
  });
});

describe('quy đổi tọa độ', () => {
  it('timeToPx và pxToTime là hàm ngược', () => {
    const r = { from: 1000, to: 2000 };
    expect(timeToPx(1500, r, 400)).toBe(200);
    expect(pxToTime(100, r, 400)).toBe(1250);
    expect(pxToTime(timeToPx(1777, r, 313), r, 313)).toBeCloseTo(1777, 6);
  });
  it('bề rộng 0 không chia cho 0', () => {
    expect(timeToPx(5, { from: 0, to: 10 }, 0)).toBe(0);
    expect(pxToTime(5, { from: 0, to: 10 }, 0)).toBe(0);
  });
});
