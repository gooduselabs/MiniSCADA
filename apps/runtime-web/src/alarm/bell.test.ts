// Chuông cảnh báo và bảng thông báo (feature 026; thay banner ngang của 009).
import { FakeActionHost, MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { AlarmBell, bellItems, bellModel, relativeTime } from './bell.ts';

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
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('bellModel', () => {
  it('none/offline: không có chuông', () => {
    expect(bellModel(src([]).snapshot(), 'none')).toBeNull();
    expect(bellModel(src([]).snapshot(), 'offline')).toBeNull();
  });
  it('live: số chưa xác nhận, mức cao nhất, aria đọc được', () => {
    const s = src([
      inst({ id: 'a', priority: 'major', class: 'major' }),
      inst({ id: 'b', priority: 'critical', class: 'critical' }),
      inst({ id: 'c', priority: 'minor', class: 'minor', state: 'ACTIVE_ACK' }),
    ]);
    expect(bellModel(s.snapshot(), 'live')).toEqual({
      kind: 'live',
      n: 2,
      text: '2',
      priority: 'critical',
      aria: 'Cảnh báo: 2 chưa xác nhận',
    });
  });
  it('không có chưa xác nhận: badge rỗng, priority null', () => {
    const m = bellModel(src([inst({ state: 'ACTIVE_ACK' })]).snapshot(), 'live');
    expect(m).toMatchObject({ n: 0, text: '', priority: null });
  });
  it('trên 99: 99+', () => {
    const list = Array.from({ length: 120 }, (_, k) => inst({ id: `x${k}` }));
    expect(bellModel(src(list).snapshot(), 'live')?.text).toBe('99+');
  });
  it('stale: lost; unsupported', () => {
    expect(bellModel(src([inst()]).snapshot(), 'stale')?.kind).toBe('lost');
    expect(bellModel(src([]).snapshot(), 'unsupported')?.kind).toBe('unsupported');
  });
});

describe('bellItems', () => {
  const s = src([
    inst({ id: 'old', priority: 'critical', class: 'critical', tsActive: 100 }),
    inst({ id: 'new', priority: 'critical', class: 'critical', tsActive: 900 }),
    inst({ id: 'maj', priority: 'major', class: 'major', tsActive: 950 }),
    inst({ id: 'ack', priority: 'critical', class: 'critical', state: 'ACTIVE_ACK' }),
    inst({ id: 'rtn', priority: 'minor', class: 'minor', state: 'RTN_UNACK' }),
    inst({ id: 'sh', shelved: shelf }),
  ]);
  it('chưa xác nhận: khẩn cấp trước, mới nhất trước; bỏ tạm ẩn và đã xác nhận', () => {
    expect(bellItems(s.snapshot(), 'unack').map((i) => i.id)).toEqual(['new', 'old', 'maj', 'rtn']);
  });
  it('tất cả: đã xác nhận ở cuối', () => {
    expect(bellItems(s.snapshot(), 'all').map((i) => i.id)).toEqual([
      'new',
      'old',
      'maj',
      'rtn',
      'ack',
    ]);
  });
});

describe('relativeTime', () => {
  it('vừa xong, giây, phút, giờ, ngày', () => {
    const n = 10_000_000;
    expect(relativeTime(n - 3000, n)).toBe('vừa xong');
    expect(relativeTime(n - 30_000, n)).toBe('30 giây trước');
    expect(relativeTime(n - 120_000, n)).toBe('2 phút trước');
    expect(relativeTime(n - 3 * 3600_000, n)).toBe('3 giờ trước');
    expect(relativeTime(n - 2 * 86400_000, n)).toBe('2 ngày trước');
    expect(relativeTime(n + 5000, n)).toBe('vừa xong');
  });
});

describe('AlarmBell (DOM)', () => {
  const make = (s: MemoryAlarmSource, host = operator(), extra = {}) => {
    const nav: string[] = [];
    const b = new AlarmBell({
      source: s,
      host,
      navigate: () => nav.push('alarms'),
      confirmMs: 1000,
      ...extra,
    });
    document.body.append(b.el);
    b.refresh();
    return { b, nav, host };
  };

  it('ẩn khi project không có alarm; hiện chuông kể cả khi 0 chưa xác nhận', () => {
    expect(make(src([], 'none')).b.el.hidden).toBe(true);
    const { b } = make(src([]));
    expect(b.el.hidden).toBe(false);
    expect(b.button.getAttribute('aria-label')).toBe('Cảnh báo: không có alarm chưa xác nhận');
    expect(b.el.querySelector<HTMLElement>('.al-bell-badge')!.hidden).toBe(true);
  });
  it('chuông là button có aria-label, aria-expanded, badge màu theo mức cao nhất', () => {
    const { b } = make(
      src([
        inst({ id: 'a', priority: 'major', class: 'major' }),
        inst({ id: 'b', priority: 'minor', class: 'minor' }),
      ]),
    );
    expect(b.button.tagName).toBe('BUTTON');
    expect(b.button.getAttribute('aria-label')).toBe('Cảnh báo: 2 chưa xác nhận');
    expect(b.button.getAttribute('aria-expanded')).toBe('false');
    expect(b.button.dataset.priority).toBe('major');
    expect(text(b.el.querySelector('.al-bell-badge'))).toBe('2');
  });
  it('bấm chuông mở bảng (role dialog), Esc đóng và trả focus về chuông', () => {
    const { b } = make(src([inst({ id: 'a', text: 'Bơm 1 lỗi' })]));
    b.button.click();
    expect(b.isOpen).toBe(true);
    expect(b.button.getAttribute('aria-expanded')).toBe('true');
    expect(b.panel.getAttribute('role')).toBe('dialog');
    expect(text(b.panel.querySelector('.al-n-text'))).toBe('Bơm 1 lỗi');
    b.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(b.isOpen).toBe(false);
    expect(document.activeElement).toBe(b.button);
  });
  it('bấm ra ngoài thì đóng', () => {
    const { b } = make(src([inst()]));
    b.open();
    const out = document.createElement('div');
    document.body.append(out);
    out.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(b.isOpen).toBe(false);
  });
  it('hàng: biểu tượng mức, nội dung, tag/giá trị, thời gian tương đối, trạng thái', () => {
    const { b } = make(
      src([
        inst({
          id: 'T.HH',
          alarmId: 'T',
          name: 'Mức bồn',
          text: 'Bồn mức cao',
          valueActive: 91.2,
          tsActive: 1_000_000 - 120_000,
          priority: 'critical',
          class: 'critical',
        }),
      ]),
    );
    b.open();
    const row = b.panel.querySelector('.al-n-item')!;
    expect(row.querySelector('.al-n-prio svg')).not.toBeNull();
    expect(text(row.querySelector('.al-n-tag'))).toBe('Mức bồn · T · Giá trị 91.2');
    expect(text(row.querySelector('.al-n-time'))).toBe('2 phút trước');
    expect(text(row.querySelector('.al-n-state'))).toBe('Chưa xác nhận');
  });
  it('bộ lọc Chưa xác nhận / Tất cả; trạng thái trống', () => {
    const { b } = make(src([inst({ id: 'k', state: 'ACTIVE_ACK' })]));
    b.open();
    expect(text(b.panel.querySelector('.al-panel-empty strong'))).toBe(
      'Không có cảnh báo chưa xác nhận',
    );
    b.panel.querySelector<HTMLButtonElement>('[data-filter="all"]')!.click();
    expect(b.panel.querySelectorAll('.al-n-item')).toHaveLength(1);
    expect(b.panel.querySelector('.al-n-ack')).toBeNull();
    const e = make(src([])).b;
    e.open();
    expect(text(e.panel.querySelector('.al-panel-empty strong'))).toBe('Không có cảnh báo');
  });
  it('Xác nhận một hàng gửi đúng {id, occurrence}', async () => {
    const { b, host } = make(
      src([inst({ id: 'a', occurrence: 7 }), inst({ id: 'b', occurrence: 8 })]),
    );
    b.open();
    b.panel.querySelector<HTMLButtonElement>('.al-n-item[data-id="b"] .al-n-ack')!.click();
    await tick();
    expect(host.ackCalls).toEqual([{ items: [{ id: 'b', occurrence: 8 }] }]);
  });
  it('Xác nhận tất cả cần bấm hai lần, gửi {all, upToRevision}', async () => {
    const { b, host } = make(src([inst({ id: 'a' }), inst({ id: 'b' })]));
    b.open();
    const btn = b.panel.querySelector<HTMLButtonElement>('.al-panel-ackall')!;
    btn.click();
    await tick();
    expect(host.ackCalls).toHaveLength(0);
    expect(text(btn)).toBe('Bấm lần nữa: xác nhận 2');
    btn.click();
    await tick();
    expect(host.ackCalls).toHaveLength(1);
    expect(host.ackCalls[0]).toMatchObject({ all: true, filter: {} });
  });
  it('viewer: nút khóa kèm lý do, bấm không gửi', async () => {
    const host = new FakeActionHost({ session: { user: 'xem1', role: 'viewer' } });
    const { b } = make(src([inst()]), host);
    b.open();
    const ack = b.panel.querySelector<HTMLButtonElement>('.al-n-ack')!;
    expect(ack.getAttribute('aria-disabled')).toBe('true');
    expect(text(b.panel.querySelector('.al-panel-lock'))).toBe('Cần đăng nhập với role operator');
    ack.click();
    await tick();
    expect(host.ackCalls).toHaveLength(0);
  });
  it('chưa đăng nhập: bấm Xác nhận mở hộp đăng nhập', () => {
    const host = new FakeActionHost({ session: null });
    const { b } = make(src([inst()]), host);
    b.open();
    b.panel.querySelector<HTMLButtonElement>('.al-n-ack')!.click();
    expect(host.calls).toContain('login');
  });
  it('Xem tất cả alarm: chuyển trang và đóng bảng', () => {
    const { b, nav } = make(src([inst()]));
    b.open();
    b.panel.querySelector<HTMLAnchorElement>('.al-panel-viewall')!.click();
    expect(nav).toEqual(['alarms']);
    expect(b.isOpen).toBe(false);
  });
  it('chuỗi project vào bằng chữ', () => {
    const { b } = make(src([inst({ text: '<img src=x onerror=1>' })]));
    b.open();
    expect(b.panel.querySelector('img')).toBeNull();
    expect(text(b.panel)).toContain('<img src=x onerror=1>');
  });
  it('alarm khẩn cấp MỚI: chuông rung và toast; alarm có sẵn lúc đầu thì không; bấm toast mở bảng', () => {
    const s = src([inst({ id: 'old', priority: 'critical', class: 'critical' })]);
    const { b } = make(s);
    expect(b.toast.hidden).toBe(true);
    s.upsert(inst({ id: 'm', priority: 'major', class: 'major' }));
    s.flush();
    expect(b.button.dataset.ring).toBe('');
    expect(b.toast.hidden).toBe(true);
    s.upsert(inst({ id: 'n', priority: 'critical', class: 'critical', text: 'Áp suất rất cao' }));
    s.flush();
    expect(b.toast.hidden).toBe(false);
    expect(text(b.toast)).toContain('Áp suất rất cao');
    b.toast.querySelector<HTMLButtonElement>('.al-toast-body')!.click();
    expect(b.toast.hidden).toBe(true);
    expect(b.isOpen).toBe(true);
  });
  it('lỗi xác nhận hiện thành chữ trong bảng', async () => {
    const host = operator();
    host.ackHandler = () => ({
      ok: false,
      error: { code: 'AUDIT_UNAVAILABLE', message: 'x' },
      results: [],
      acked: 0,
      skippedNewer: 0,
    });
    const { b } = make(src([inst()]), host);
    b.open();
    b.panel.querySelector<HTMLButtonElement>('.al-n-ack')!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(text(b.panel.querySelector('.al-panel-msg'))).toContain(
      'Thiết bị không ghi được nhật ký kiểm toán',
    );
  });
  it('stale: badge "!" và thông báo mất kết nối trong bảng', () => {
    const { b } = make(src([inst()], 'stale'));
    expect(b.button.dataset.kind).toBe('lost');
    b.open();
    expect(text(b.panel.querySelector('.al-panel-notice'))).toBe(
      'Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ',
    );
  });
});
