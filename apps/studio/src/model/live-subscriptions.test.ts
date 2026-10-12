// LiveSubscriptions (feature 006, T119, data-model §13.5, R22): mỗi nơi khai tập Tag kèm ưu tiên; hợp lại; cắt ở
// 1.000 Tag theo ưu tiên; gửi sau 300 ms yên lặng; Bảng Tag 2.000 dòng chỉ đăng ký dòng đang hiện.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSubscriptions, MAX_SUBSCRIBED, PRIORITY, QUIET_MS } from './live-subscriptions.ts';

function make() {
  const applied: string[][] = [];
  const subs = new LiveSubscriptions((tags) => void applied.push([...tags]));
  return { subs, applied };
}

describe('LiveSubscriptions', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('ưu tiên: Bảng theo dõi 3, xem trước màn hình 2, dòng đang hiện của Bảng Tag 1', () => {
    expect(PRIORITY).toMatchObject({ watch: 3, preview: 2, tagTable: 1 });
    expect(QUIET_MS).toBe(300);
    expect(MAX_SUBSCRIBED).toBe(1000);
  });

  it('hợp các nơi khai, không trùng, xếp theo ưu tiên giảm dần rồi theo thứ tự khai', () => {
    const { subs, applied } = make();
    subs.declare('grid', ['A', 'B'], PRIORITY.tagTable);
    subs.declare('watch', ['C', 'A'], PRIORITY.watch);
    subs.declare('preview', ['D'], PRIORITY.preview);
    vi.advanceTimersByTime(QUIET_MS);
    expect(applied).toEqual([['A', 'C', 'D', 'B']]);
  });

  it('gửi một lần sau 300 ms yên lặng: mỗi lần khai lại làm mới đồng hồ', () => {
    const { subs, applied } = make();
    subs.declare('grid', ['A'], 1);
    vi.advanceTimersByTime(200);
    subs.declare('grid', ['A', 'B'], 1);
    vi.advanceTimersByTime(200);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(applied).toEqual([['A', 'B']]);
  });

  it('không gửi lại khi tập hợp lại không đổi', () => {
    const { subs, applied } = make();
    subs.declare('grid', ['A'], 1);
    vi.advanceTimersByTime(QUIET_MS);
    subs.declare('grid', ['A'], 1);
    vi.advanceTimersByTime(QUIET_MS);
    expect(applied).toHaveLength(1);
  });

  it('release bỏ phần của một nơi; hết nơi nào khai thì gửi tập rỗng', () => {
    const { subs, applied } = make();
    subs.declare('watch', ['A'], 3);
    subs.declare('grid', ['B'], 1);
    vi.advanceTimersByTime(QUIET_MS);
    subs.release('watch');
    vi.advanceTimersByTime(QUIET_MS);
    subs.release('grid');
    vi.advanceTimersByTime(QUIET_MS);
    expect(applied).toEqual([['A', 'B'], ['B'], []]);
  });

  it('cắt ở 1.000 Tag theo ưu tiên: Tag ưu tiên cao còn, Tag ưu tiên thấp bị bỏ', () => {
    const { subs, applied } = make();
    const grid = Array.from({ length: 900 }, (_, i) => `G${i}`);
    const watch = Array.from({ length: 300 }, (_, i) => `W${i}`);
    subs.declare('grid', grid, 1);
    subs.declare('watch', watch, 3);
    vi.advanceTimersByTime(QUIET_MS);
    const got = applied[0];
    expect(got).toHaveLength(1000);
    expect(got.slice(0, 300)).toEqual(watch);
    expect(got).toContain('G699');
    expect(got).not.toContain('G700');
    expect(subs.truncated).toBe(200);
  });

  it('một Tag khai ở hai nơi lấy ưu tiên cao nhất', () => {
    const { subs, applied } = make();
    subs.declare('grid', ['X', 'Y'], 1);
    subs.declare('preview', ['Y'], 2);
    vi.advanceTimersByTime(QUIET_MS);
    expect(applied[0]).toEqual(['Y', 'X']);
  });

  it('flush gửi ngay; dispose hủy đồng hồ đang chờ', () => {
    const { subs, applied } = make();
    subs.declare('base', ['A'], 0);
    subs.flush();
    expect(applied).toEqual([['A']]);
    subs.declare('base', ['B'], 0);
    subs.dispose();
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(applied).toHaveLength(1);
  });

  it('Bảng Tag 2.000 dòng: chỉ đăng ký các dòng đang hiện', () => {
    const { subs, applied } = make();
    const visible = Array.from({ length: 40 }, (_, i) => `T${i + 500}`);
    subs.declare('tag-table', visible, PRIORITY.tagTable);
    vi.advanceTimersByTime(QUIET_MS);
    expect(applied[0]).toEqual(visible);
  });
});
