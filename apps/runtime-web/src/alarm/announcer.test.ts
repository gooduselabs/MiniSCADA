// Vùng đọc alarm (feature 009, FR-058; contracts/ui-alarm.md §10).
import { MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { AlarmAnnouncer } from './announcer.ts';

afterEach(() => document.body.replaceChildren());

const src = (list: ReturnType<typeof inst>[]) =>
  new MemoryAlarmSource({
    instances: list,
    classes: CLASSES,
    areas: AREAS,
    status: 'live',
    now: 1_000_000,
  });

describe('AlarmAnnouncer (§10)', () => {
  const setup = () => {
    const status = document.createElement('div');
    const alert = document.createElement('div');
    let t = 0;
    const timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let id = 0;
    const a = new AlarmAnnouncer({
      status,
      alert,
      now: () => t,
      setTimer: (fn, ms) => {
        timers.push({ at: t + ms, fn, id: ++id });
        return id;
      },
      clearTimer: (h) => {
        const i = timers.findIndex((x) => x.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const advance = (ms: number) => {
      const end = t + ms;
      for (;;) {
        timers.sort((p, q) => p.at - q.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift();
        t = n.at;
        n.fn();
      }
      t = end;
    };
    return { status, alert, a, advance };
  };
  const crit = (id: string, occ = 1, text = `Khẩn ${id}`) =>
    inst({ id, occurrence: occ, text, priority: 'critical', class: 'critical' });

  it('vùng role=status polite và role=alert assertive, ẩn thị giác', () => {
    const { status, alert } = setup();
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });
  it('alarm khẩn cấp mới: báo bằng vùng alert; alarm có sẵn ở snapshot đầu không báo là mới', () => {
    const { alert, a } = setup();
    const s = src([crit('old')]);
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('');
    s.upsert(crit('new', 1, 'Bồn B1 mức rất cao'));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('Khẩn cấp: Bồn B1 mức rất cao');
  });
  it('lần xảy ra mới của cùng id cũng là alarm mới', () => {
    const { alert, a, advance } = setup();
    const s = src([]);
    a.update(s.snapshot(), 'live');
    s.upsert(crit('x', 1));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('Khẩn cấp: Khẩn x');
    advance(3000);
    s.upsert(crit('x', 2, 'Lại bật'));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('Khẩn cấp: Lại bật');
  });
  it('mức khác khẩn cấp không dùng vùng alert', () => {
    const { alert, a } = setup();
    const s = src([]);
    a.update(s.snapshot(), 'live');
    s.upsert(inst({ id: 'm', priority: 'major', class: 'major' }));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('');
  });
  it('nhiều alarm khẩn cấp trong 3 giây gộp thành "n alarm khẩn cấp mới"', () => {
    const { alert, a, advance } = setup();
    const s = src([]);
    a.update(s.snapshot(), 'live');
    s.upsert(crit('1'));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('Khẩn cấp: Khẩn 1');
    advance(500);
    s.upsert(crit('2'));
    a.update(s.snapshot(), 'live');
    advance(500);
    s.upsert(crit('3'));
    a.update(s.snapshot(), 'live');
    expect(alert.textContent).toBe('Khẩn cấp: Khẩn 1'); // chưa báo thêm trong cửa sổ 3 s
    advance(2500);
    expect(alert.textContent).toBe('2 alarm khẩn cấp mới');
  });
  it('vùng status báo số chưa xác nhận, giới hạn một lần mỗi 3 giây', () => {
    const { status, a, advance } = setup();
    const s = src([]);
    a.update(s.snapshot(), 'live');
    s.upsert(inst({ id: '1' }));
    a.update(s.snapshot(), 'live');
    expect(status.textContent).toBe('1 alarm chưa xác nhận');
    s.upsert(inst({ id: '2' }));
    a.update(s.snapshot(), 'live');
    expect(status.textContent).toBe('1 alarm chưa xác nhận');
    advance(3000);
    expect(status.textContent).toBe('2 alarm chưa xác nhận');
  });
  it('mất kết nối báo bằng vùng status', () => {
    const { status, a } = setup();
    const s = src([inst()]);
    a.update(s.snapshot(), 'live');
    a.update(s.snapshot(), 'stale');
    expect(status.textContent).toBe('Mất kết nối tới thiết bị');
  });
});
