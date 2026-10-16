import { describe, expect, it } from 'vitest';
import { ChartWindow } from './window.ts';

const mk = (over: Partial<ConstructorParameters<typeof ChartWindow>[0]> = {}) =>
  new ChartWindow({ series: 2, capacity: 3600, windowSec: 60, sampleMs: 1000, ...over });

describe('ChartWindow', () => {
  it('snapshot trả x theo giây và một mảng mỗi đường', () => {
    const w = mk();
    w.sample(1000, [1, 10]);
    w.sample(2000, [2, 20]);
    const s = w.snapshot(2000);
    expect(s).toHaveLength(3);
    expect([...s[0]!]).toEqual([1, 2]);
    expect([...s[1]!]).toEqual([1, 2]);
    expect([...s[2]!]).toEqual([10, 20]);
  });

  it('chỉ giữ điểm trong cửa sổ cuối', () => {
    const w = mk({ windowSec: 10 });
    for (let i = 0; i <= 30; i++) w.sample(i * 1000, [i, -i]);
    const s = w.snapshot(30_000);
    expect(s[0]![0]).toBe(20);
    expect(s[0]![s[0]!.length - 1]).toBe(30);
    expect(s[1]![0]).toBe(20);
  });

  it('vòng: ghi đè điểm cũ nhất khi đầy, thứ tự thời gian giữ đúng', () => {
    const w = mk({ capacity: 5, windowSec: 3600 });
    for (let i = 1; i <= 8; i++) w.sample(i * 1000, [i, i]);
    const s = w.snapshot(8000);
    expect([...s[0]!]).toEqual([4, 5, 6, 7, 8]);
    expect([...s[1]!]).toEqual([4, 5, 6, 7, 8]);
  });

  it('null và NaN đều thành NaN (khoảng đứt)', () => {
    const w = mk();
    w.sample(1000, [1, 1]);
    w.sample(2000, [null, NaN]);
    w.sample(3000, [3, 3]);
    const s = w.snapshot(3000);
    expect(Number.isNaN(s[1]![1]!)).toBe(true);
    expect(Number.isNaN(s[2]![1]!)).toBe(true);
    expect(s[1]![2]).toBe(3);
  });

  it('khoảng thiếu > 3 x sampleMs chèn một điểm NaN để đứt, không nội suy', () => {
    const w = mk({ sampleMs: 1000 });
    w.sample(1000, [1, 1]);
    w.sample(2000, [2, 2]);
    w.sample(10_000, [9, 9]); // thiếu 8 s
    const s = w.snapshot(10_000);
    expect(s[0]!.length).toBe(4);
    expect(s[0]![2]).toBeGreaterThan(2);
    expect(s[0]![2]).toBeLessThan(10);
    expect(Number.isNaN(s[1]![2]!)).toBe(true);
    expect(Number.isNaN(s[2]![2]!)).toBe(true);
    expect(s[1]![3]).toBe(9);
  });

  it('khoảng thiếu đúng 3 x sampleMs thì chưa đứt', () => {
    const w = mk({ sampleMs: 1000 });
    w.sample(1000, [1, 1]);
    w.sample(4000, [4, 4]);
    expect(w.snapshot(4000)[0]!.length).toBe(2);
  });

  it('mẫu lệch giờ: t cũ hơn mẫu cuối bị bỏ; t bằng thì ghi đè mẫu cuối', () => {
    const w = mk();
    w.sample(5000, [5, 50]);
    w.sample(4000, [4, 40]);
    w.sample(5000, [6, 60]);
    const s = w.snapshot(5000);
    expect([...s[0]!]).toEqual([5]);
    expect([...s[1]!]).toEqual([6]);
    expect([...s[2]!]).toEqual([60]);
  });

  // T041 (FR-026, D32): đồng hồ lùi (NTP, chỉnh tay) làm biểu đồ đứng hình tới khi giờ mới vượt mẫu cuối cũ.
  it('đồng hồ lùi > 2 s: đặt lại cửa sổ và nhận mẫu mới', () => {
    const w = mk({ windowSec: 3600 });
    w.sample(3_600_000, [1, 10]);
    w.sample(3_601_000, [2, 20]);
    w.sample(1_000, [3, 30]); // lùi gần một giờ
    expect(w.count).toBe(1);
    const s = w.snapshot(1_000);
    expect([...s[0]!]).toEqual([1]);
    expect([...s[1]!]).toEqual([3]);
    w.sample(2_000, [4, 40]);
    expect([...w.snapshot(2_000)[1]!]).toEqual([3, 4]);
  });

  it('đồng hồ lùi đúng 2 s hoặc ít hơn: bỏ mẫu, giữ cửa sổ', () => {
    const w = mk();
    w.sample(10_000, [1, 10]);
    w.sample(8_000, [2, 20]); // lùi 2 s
    w.sample(9_500, [3, 30]);
    expect(w.count).toBe(1);
    expect([...w.snapshot(10_000)[1]!]).toEqual([1]);
    w.sample(7_999, [4, 40]); // lùi 2,001 s
    expect(w.count).toBe(1);
    expect([...w.snapshot(7_999)[1]!]).toEqual([4]);
  });

  it('snapshot không trả điểm tương lai so với now', () => {
    const w = mk();
    for (let i = 1; i <= 4; i++) w.sample(i * 1000, [i, i]);
    expect([...w.snapshot(2500)[0]!]).toEqual([1, 2]);
  });

  it('tab ẩn rồi hiện: mẫu thưa nhưng thời điểm đúng giờ thật', () => {
    const w = mk({ sampleMs: 1000 });
    w.sample(0, [1, 1]);
    w.sample(1000, [1, 1]);
    w.sample(2000, [1, 1]);
    w.sample(3000, [1, 1]);
    w.sample(4000, [1, 1]);
    w.sample(5500, [2, 2]);
    const s = w.snapshot(5500);
    expect(s[0]![s[0]!.length - 1]).toBe(5.5);
  });

  it('reset xóa mọi điểm', () => {
    const w = mk();
    w.sample(1000, [1, 1]);
    w.reset();
    expect(w.snapshot(1000)[0]!.length).toBe(0);
    w.sample(500, [3, 3]); // sau reset, giờ cũ hơn mẫu trước vẫn nhận
    expect(w.snapshot(1000)[0]!.length).toBe(1);
  });

  it('bộ đệm cố định: capacity mẫu, mảng nền không đổi chỗ sau khi dựng', () => {
    const w = mk({ capacity: 4 });
    expect(w.capacity).toBe(4);
    for (let i = 1; i <= 100; i++) w.sample(i * 1000, [i, i]);
    expect(w.count).toBe(4);
  });

  it('không có mẫu: snapshot rỗng nhưng đủ số mảng', () => {
    const s = mk({ series: 3 }).snapshot(0);
    expect(s).toHaveLength(4);
    expect(s.every((a) => a.length === 0)).toBe(true);
  });

  it('đổi windowSec rồi snapshot theo cửa sổ mới, không mất dữ liệu trong vòng', () => {
    const w = mk({ windowSec: 5 });
    for (let i = 0; i <= 20; i++) w.sample(i * 1000, [i, i]);
    expect(w.snapshot(20_000)[0]!.length).toBe(6);
    w.windowSec = 15;
    expect(w.snapshot(20_000)[0]!.length).toBe(16);
  });
});
