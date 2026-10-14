// Banner alarm (feature 009, FR-055, FR-057, FR-058; US1 kịch bản 1, 2, 7, 8; contracts/ui-alarm.md §6, §8, §10).
import { FakeActionHost, MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { AlarmAnnouncer, AlarmBanner, bannerModel } from './banner.ts';

afterEach(() => document.body.replaceChildren());

const shelf = { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false };
const operator = () => new FakeActionHost({ session: { user: 'vanhanh1', role: 'operator' } });
const src = (
  list: ReturnType<typeof inst>[],
  status: 'live' | 'stale' | 'offline' | 'none' | 'unsupported' = 'live',
) =>
  new MemoryAlarmSource({
    instances: list,
    classes: CLASSES,
    areas: AREAS,
    status,
    now: 1_000_000,
  });

describe('bannerModel (§6)', () => {
  it('none: ẩn; live không có chưa xác nhận: ẩn', () => {
    expect(bannerModel(src([]).snapshot(), 'none', null)).toBeNull();
    expect(bannerModel(src([inst({ state: 'ACTIVE_ACK' })]).snapshot(), 'live', null)).toBeNull();
  });
  it('offline (chưa từng có dữ liệu): ẩn, đã có chỉ báo kết nối ở thanh trên', () => {
    expect(bannerModel(src([]).snapshot(), 'offline', null)).toBeNull();
  });
  it('unsupported: một dòng cảnh báo, không nút', () => {
    expect(bannerModel(src([]).snapshot(), 'unsupported', null)).toEqual({ kind: 'unsupported' });
  });
  it('stale: mất kết nối', () => {
    expect(bannerModel(src([inst()]).snapshot(), 'stale', null)).toEqual({ kind: 'lost' });
  });
  it('có chưa xác nhận: alarm ưu tiên cao nhất rồi mới nhất, số theo mức, canAck theo khóa', () => {
    const s = src([
      inst({ id: 'a', priority: 'major', class: 'major', tsActive: 900 }),
      inst({ id: 'b', priority: 'critical', class: 'critical', tsActive: 100 }),
      inst({ id: 'c', priority: 'critical', class: 'critical', tsActive: 200 }),
      inst({ id: 'd', priority: 'minor', class: 'minor', state: 'ACTIVE_ACK' }),
    ]);
    const m = bannerModel(s.snapshot(), 'live', null);
    expect(m).toMatchObject({ kind: 'unack', n: 3, canAck: true });
    if (m?.kind !== 'unack') throw new Error('kind');
    expect(m.top?.id).toBe('c');
    expect(m.chips).toEqual([
      { priority: 'critical', n: 2 },
      { priority: 'major', n: 1 },
    ]);
    expect(m.lock).toBeNull();
  });
  it('bị khóa: canAck false và giữ lý do', () => {
    const s = src([inst()]);
    const m = bannerModel(s.snapshot(), 'live', {
      code: 'ROLE',
      message: 'Cần đăng nhập với role operator',
    });
    expect(m).toMatchObject({ kind: 'unack', canAck: false });
  });
  it('shelved không tính vào alarm hiện ở banner', () => {
    const s = src([
      inst({ id: 'sh', priority: 'critical', class: 'critical', shelved: shelf }),
      inst({ id: 'x', priority: 'minor', class: 'minor' }),
    ]);
    const m = bannerModel(s.snapshot(), 'live', null);
    if (m?.kind !== 'unack') throw new Error('kind');
    expect(m.top?.id).toBe('x');
    expect(m.n).toBe(1);
  });
  it('chỉ còn RTN_UNACK: tông nhạt, không nhấp nháy, nội dung "n đã hết, chưa xác nhận"', () => {
    const s = src([
      inst({ state: 'RTN_UNACK', class: 'major', priority: 'major' }),
      inst({ state: 'RTN_UNACK', class: 'minor', priority: 'minor' }),
    ]);
    expect(bannerModel(s.snapshot(), 'live', null)).toMatchObject({ kind: 'returnOnly', n: 2 });
  });
});

describe('AlarmBanner (DOM)', () => {
  const make = (
    s: MemoryAlarmSource,
    host = operator(),
    extra: Partial<ConstructorParameters<typeof AlarmBanner>[0]> = {},
  ) => {
    const nav: string[] = [];
    const b = new AlarmBanner({
      source: s,
      host,
      navigate: () => nav.push('alarms'),
      reducedMotion: () => false,
      ...extra,
    });
    document.body.append(b.el);
    b.refresh();
    return { b, nav, host };
  };
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('ẩn khi không có alarm chưa xác nhận', () => {
    const { b } = make(src([]));
    expect(b.el.hidden).toBe(true);
  });
  it('nội dung: mức ưu tiên · nội dung · tổng chưa xác nhận; vùng có nhãn "Alarm"', () => {
    const s = src([
      inst({
        id: 'a',
        priority: 'critical',
        class: 'critical',
        text: 'Bồn B1 mức rất cao: 91,2 % (ngưỡng 90)',
      }),
      inst({ id: 'b', priority: 'major', class: 'major' }),
    ]);
    const { b } = make(s);
    expect(b.el.hidden).toBe(false);
    expect(b.el.getAttribute('role')).toBe('region');
    expect(b.el.getAttribute('aria-label')).toBe('Alarm');
    expect(text(b.el.querySelector('.al-banner-text')!)).toBe(
      'Khẩn cấp · Bồn B1 mức rất cao: 91,2 % (ngưỡng 90) · 2 chưa xác nhận',
    );
  });
  it('chip đếm theo mức có biểu tượng và số; chỉ mức có chưa xác nhận', () => {
    const s = src([
      inst({ id: 'a', priority: 'critical', class: 'critical' }),
      inst({ id: 'b', priority: 'critical', class: 'critical' }),
      inst({ id: 'c', priority: 'minor', class: 'minor' }),
    ]);
    const { b } = make(s);
    const chips = [...b.el.querySelectorAll('.al-chip')];
    expect(chips.map((c) => text(c))).toEqual(['2', '1']);
    expect(chips.every((c) => c.querySelector('svg') !== null)).toBe(true);
    expect(chips[0]!.getAttribute('aria-label')).toBe('2 alarm Khẩn cấp');
  });
  it('màu và nhấp nháy theo lớp của alarm đang hiện', () => {
    const { b } = make(src([inst({ priority: 'critical', class: 'critical' })]));
    expect(b.el.dataset.color).toBe('red');
    expect(b.el.dataset.blink).toBe('on');
    const b2 = make(src([inst({ priority: 'minor', class: 'minor' })])).b;
    expect(b2.el.dataset.blink).toBe('off');
  });
  it('prefers-reduced-motion: không nhấp nháy, viền đậm tĩnh', () => {
    const { b } = make(src([inst({ priority: 'critical', class: 'critical' })]), operator(), {
      reducedMotion: () => true,
    });
    expect(b.el.dataset.blink).toBe('static');
  });
  it('nút Xác nhận chỉ xác nhận đúng alarm đang hiện, không phải tất cả', async () => {
    const s = src([
      inst({ id: 'a', occurrence: 7, priority: 'critical', class: 'critical', tsActive: 5 }),
      inst({ id: 'b', occurrence: 8, priority: 'minor', class: 'minor', tsActive: 9 }),
    ]);
    const { b, host } = make(s);
    b.el.querySelector<HTMLButtonElement>('button.al-banner-ack')!.click();
    await Promise.resolve();
    expect(host.ackCalls).toEqual([{ items: [{ id: 'a', occurrence: 7 }] }]);
  });
  it('viewer: nút còn, aria-disabled kèm lý do hiện cạnh nút; bấm không gọi host', async () => {
    const host = new FakeActionHost({ session: { user: 'xem1', role: 'viewer' } });
    const { b } = make(src([inst()]), host);
    const btn = b.el.querySelector<HTMLButtonElement>('button.al-banner-ack')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(text(b.el.querySelector('.al-banner-lock')!)).toBe('Cần đăng nhập với role operator');
    btn.click();
    await Promise.resolve();
    expect(host.ackCalls).toHaveLength(0);
  });
  it('chưa đăng nhập: bấm nút mở hộp đăng nhập', () => {
    const host = new FakeActionHost({ session: null });
    const { b } = make(src([inst()]), host);
    b.el.querySelector<HTMLButtonElement>('button.al-banner-ack')!.click();
    expect(host.calls).toContain('login');
  });
  it('bấm vào thân banner chuyển tới trang Alarm; bấm nút Xác nhận thì không chuyển', async () => {
    const { b, nav } = make(src([inst()]));
    b.el.querySelector<HTMLElement>('.al-banner-body')!.click();
    expect(nav).toEqual(['alarms']);
    b.el.querySelector<HTMLButtonElement>('button.al-banner-ack')!.click();
    await Promise.resolve();
    expect(nav).toEqual(['alarms']);
  });
  it('cập nhật khi nguồn đổi (xác nhận xong thì ẩn); chuỗi project vào bằng chữ', async () => {
    const s = src([
      inst({ id: 'a', text: '<img src=x onerror=1>', class: 'critical', priority: 'critical' }),
    ]);
    const { b } = make(s);
    expect(b.el.querySelector('img')).toBeNull();
    expect(text(b.el)).toContain('<img src=x onerror=1>');
    s.upsert(inst({ id: 'a', state: 'ACTIVE_ACK' }));
    s.flush();
    expect(b.el.hidden).toBe(true);
  });
  it('unsupported: một dòng cảnh báo, không nút; stale: mất kết nối, không nút', () => {
    const u = make(src([], 'unsupported')).b;
    expect(text(u.el)).toBe('Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)');
    expect(u.el.querySelector('button')).toBeNull();
    const s = src([inst()], 'stale');
    const l = make(s).b;
    expect(text(l.el)).toBe('Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ');
    expect(l.el.dataset.tone).toBe('bad');
    expect(l.el.querySelector('button')).toBeNull();
  });
  it('chỉ còn đã hết chưa xác nhận: tông nhạt không nhấp nháy', () => {
    const { b } = make(src([inst({ state: 'RTN_UNACK', class: 'major', priority: 'major' })]));
    expect(b.el.dataset.tone).toBe('soft');
    expect(b.el.dataset.blink).toBe('off');
    expect(text(b.el.querySelector('.al-banner-text')!)).toBe('1 đã hết, chưa xác nhận');
  });
  it('lỗi xác nhận hiện thành chữ ngay trong banner', async () => {
    const host = operator();
    host.ackHandler = () => ({
      ok: false,
      error: { code: 'AUDIT_UNAVAILABLE', message: 'x' },
      results: [],
      acked: 0,
      skippedNewer: 0,
    });
    const { b } = make(src([inst()]), host);
    b.el.querySelector<HTMLButtonElement>('button.al-banner-ack')!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(text(b.el.querySelector('.al-banner-msg')!)).toContain(
      'Thiết bị không ghi được nhật ký kiểm toán',
    );
  });
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
