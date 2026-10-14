// Huy hiệu menu và tiêu đề tab (feature 009, FR-057, FR-066; contracts/ui-alarm.md §11).
import { MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { TabTitle, applyBadge, badgeModel, tabTitle } from './badge.ts';

afterEach(() => {
  document.title = '';
});

const src = (list: ReturnType<typeof inst>[]) =>
  new MemoryAlarmSource({ instances: list, classes: CLASSES, areas: AREAS });
const shelf = { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false };

describe('badgeModel', () => {
  it('bằng counts.unack; ẩn khi 0', () => {
    expect(badgeModel(src([]).snapshot(), 'live')).toBeNull();
    expect(badgeModel(src([inst({ state: 'ACTIVE_ACK' })]).snapshot(), 'live')).toBeNull();
    const m = badgeModel(src([inst(), inst(), inst()]).snapshot(), 'live');
    expect(m).toMatchObject({ n: 3, text: '3' });
  });
  it('không tính shelved; aria-label đọc được ("n alarm chưa xác nhận")', () => {
    const m = badgeModel(src([inst(), inst({ shelved: shelf })]).snapshot(), 'live')!;
    expect(m.n).toBe(1);
    expect(m.aria).toBe('1 alarm chưa xác nhận');
  });
  it('màu theo mức ưu tiên cao nhất trong các alarm chưa xác nhận', () => {
    const m = badgeModel(
      src([
        inst({ priority: 'minor', class: 'minor' }),
        inst({ priority: 'major', class: 'major' }),
        inst({ priority: 'critical', class: 'critical', state: 'ACTIVE_ACK' }),
      ]).snapshot(),
      'live',
    )!;
    expect(m.priority).toBe('major');
  });
  it('trên 99 hiện 99+', () => {
    const many = Array.from({ length: 120 }, () => inst());
    const m = badgeModel(src(many).snapshot(), 'live')!;
    expect(m.text).toBe('99+');
    expect(m.aria).toBe('120 alarm chưa xác nhận');
  });
  it('none, unsupported, offline: không huy hiệu; stale: giữ số cuối', () => {
    const s = src([inst()]);
    expect(badgeModel(s.snapshot(), 'none')).toBeNull();
    expect(badgeModel(s.snapshot(), 'unsupported')).toBeNull();
    expect(badgeModel(s.snapshot(), 'offline')).toBeNull();
    expect(badgeModel(s.snapshot(), 'stale')).not.toBeNull();
  });
});

describe('applyBadge', () => {
  it('đặt chữ, aria-label, màu theo mức; ẩn khi null', () => {
    const el = document.createElement('span');
    applyBadge(el, { n: 3, text: '3', aria: '3 alarm chưa xác nhận', priority: 'critical' });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('3');
    expect(el.getAttribute('aria-label')).toBe('3 alarm chưa xác nhận');
    expect(el.dataset.priority).toBe('critical');
    applyBadge(el, null);
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
  });
});

describe('tiêu đề tab', () => {
  it('tabTitle: tiền tố (n); 99+; 0 giữ nguyên', () => {
    expect(tabTitle('Tổng quan', 3)).toBe('(3) Tổng quan');
    expect(tabTitle('Tổng quan', 150)).toBe('(99+) Tổng quan');
    expect(tabTitle('Tổng quan', 0)).toBe('Tổng quan');
  });
  it('TabTitle đặt và khôi phục tiêu đề gốc', () => {
    document.title = 'Trạm bơm';
    const t = new TabTitle(document);
    t.set(3);
    expect(document.title).toBe('(3) Trạm bơm');
    t.set(5);
    expect(document.title).toBe('(5) Trạm bơm');
    t.set(0);
    expect(document.title).toBe('Trạm bơm');
    t.dispose();
  });
  it('nơi khác đổi tiêu đề (đổi màn hình): lấy làm gốc mới và giữ tiền tố', async () => {
    document.title = 'Màn A';
    const t = new TabTitle(document);
    t.set(2);
    document.title = 'Màn B';
    await new Promise((r) => setTimeout(r, 10));
    expect(document.title).toBe('(2) Màn B');
    t.set(0);
    expect(document.title).toBe('Màn B');
    t.dispose();
  });
});
