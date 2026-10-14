// Trang Alarm #/alarms (feature 009, FR-056, FR-064, FR-065; US1 kịch bản 3, 4, 8; contracts/ui-alarm.md §7).
import { FakeActionHost, MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlarmPage } from './alarm-page.ts';

const frame = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
const shelf = { until: 9, remainingMs: 600_000, reason: 'r', user: 'u', system: false };

const LIST = () => [
  inst({
    id: 'A',
    area: 'bon',
    priority: 'critical',
    class: 'critical',
    text: 'Mức bồn cao',
    tsActive: 5,
    occurrence: 11,
  }),
  inst({
    id: 'B',
    area: null,
    priority: 'major',
    class: 'major',
    text: 'Bơm lỗi',
    tsActive: 4,
    occurrence: 12,
  }),
  inst({
    id: 'C',
    area: 'dien',
    priority: 'minor',
    class: 'minor',
    state: 'ACTIVE_ACK',
    text: 'Điện áp thấp',
    tsActive: 3,
  }),
  inst({
    id: 'D',
    area: 'bon',
    priority: 'minor',
    class: 'minor',
    state: 'RTN_UNACK',
    text: 'Đã hết',
    tsActive: 2,
  }),
  inst({
    id: 'S',
    priority: 'advisory',
    class: 'advisory',
    state: 'NORMAL',
    shelved: shelf,
    occurrence: 0,
    text: 'Cảm biến ẩn',
  }),
];

function setup(host = new FakeActionHost({ session: { user: 'vanhanh1', role: 'operator' } })) {
  const src = new MemoryAlarmSource({
    instances: LIST(),
    classes: CLASSES,
    areas: AREAS,
    now: 1_000_000,
    revision: 500,
  });
  const page = new AlarmPage({ source: src, host });
  document.body.append(page.el);
  page.show();
  return { src, host, page };
}
const table = (p: AlarmPage) =>
  p.el.querySelector('mat-alarm-table') as HTMLElement & {
    shadowRoot: ShadowRoot;
    updateComplete: Promise<boolean>;
  };
const rowIds = (p: AlarmPage) =>
  [...table(p).shadowRoot.querySelectorAll<HTMLElement>('tbody tr[data-id]')].map(
    (r) => r.dataset.id,
  );
const sel = (p: AlarmPage, name: string) =>
  p.el.querySelector<HTMLSelectElement>(`select[data-f="${name}"]`)!;
const setSel = async (p: AlarmPage, name: string, v: string) => {
  const s = sel(p, name);
  s.value = v;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await frame();
};
const btn = (p: AlarmPage, act: string) =>
  p.el.querySelector<HTMLButtonElement>(`button[data-act="${act}"]`)!;
const dlg = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const check = (p: AlarmPage, id: string) =>
  table(p)
    .shadowRoot.querySelector<HTMLInputElement>(`tr[data-id="${id}"] input[type="checkbox"]`)!
    .click();

beforeEach(() => sessionStorage.clear());
afterEach(() => document.body.replaceChildren());

describe('bố cục và tab', () => {
  it('tiêu đề, tab Đang có (n) và Tạm ẩn (m) theo counts, bảng dùng chung', async () => {
    const { page } = setup();
    await frame();
    expect(text(page.el.querySelector('h2'))).toBe('Alarm');
    const tabs = [...page.el.querySelectorAll('[role="tab"]')].map((t) => text(t));
    expect(tabs).toEqual(['Đang có (4)', 'Tạm ẩn (1)']);
    expect(rowIds(page)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('chuyển tab Tạm ẩn: chỉ hàng shelved; aria-selected', async () => {
    const { page } = setup();
    page.el.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
    await frame();
    expect(rowIds(page)).toEqual(['S']);
    expect(page.el.querySelectorAll('[role="tab"]')[1]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('lọc (FR-056)', () => {
  it('khu vực (gồm Chung), lớp, ưu tiên, trạng thái, chữ không dấu', async () => {
    const { page } = setup();
    await setSel(page, 'area', 'bon');
    expect(rowIds(page)).toEqual(['A', 'D']);
    await setSel(page, 'area', '-');
    expect(rowIds(page)).toEqual(['B']);
    await setSel(page, 'area', '');
    await setSel(page, 'cls', 'minor');
    expect(rowIds(page)).toEqual(['C', 'D']);
    await setSel(page, 'cls', '');
    await setSel(page, 'prio', 'critical');
    expect(rowIds(page)).toEqual(['A']);
    await setSel(page, 'prio', '');
    await setSel(page, 'state', 'rtn');
    expect(rowIds(page)).toEqual(['D']);
    await setSel(page, 'state', 'ack');
    expect(rowIds(page)).toEqual(['C']);
    await setSel(page, 'state', '');
    const q = page.el.querySelector<HTMLInputElement>('input[type="search"]')!;
    q.value = 'bom';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    expect(rowIds(page)).toEqual(['B']);
  });
  it('Xóa lọc đưa về mặc định', async () => {
    const { page } = setup();
    await setSel(page, 'area', 'bon');
    btn(page, 'clear').click();
    await frame();
    expect(rowIds(page)).toEqual(['A', 'B', 'C', 'D']);
    expect(sel(page, 'area').value).toBe('');
  });
  it('bộ lọc và sắp xếp giữ qua tải lại (sessionStorage) và qua hộp đăng nhập', async () => {
    const a = setup();
    await setSel(a.page, 'area', 'bon');
    table(a.page).shadowRoot.querySelector<HTMLElement>('th button[data-col="text"]')!.click();
    await frame();
    a.page.el.remove();
    const b = setup();
    await frame();
    expect(sel(b.page, 'area').value).toBe('bon');
    expect(rowIds(b.page)).toEqual(['D', 'A']); // text tăng dần: "Mức bồn cao" sau "Đã hết"? theo localeCompare vi
  });
  it('sessionStorage ném lỗi: trang vẫn chạy', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => setup()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'sessionStorage', orig);
    }
  });
});

describe('xác nhận (FR-064, US1 kịch bản 3, 4)', () => {
  it('xác nhận hàng chọn: gửi ngay, không hộp, đúng {id, occurrence}; chỉ hàng xác nhận được', async () => {
    const { page, host } = setup();
    await frame();
    check(page, 'A');
    check(page, 'C'); // ACTIVE_ACK: bỏ qua
    check(page, 'D');
    await frame();
    expect(text(page.el.querySelector('[data-sel]'))).toBe('3 hàng đã chọn');
    btn(page, 'ack').click();
    await frame();
    expect(dlg()).toBeNull();
    expect(host.ackCalls).toEqual([
      {
        items: [
          { id: 'A', occurrence: 11 },
          { id: 'D', occurrence: expect.any(Number) },
        ],
      },
    ]);
  });
  it('Xác nhận tất cả: hộp nêu số lượng và bộ lọc, gửi upToRevision lúc MỞ HỘP và filter', async () => {
    const { page, host, src } = setup();
    await setSel(page, 'area', 'bon');
    btn(page, 'ackall').click();
    await frame();
    const d = dlg()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(text(d)).toContain('Xác nhận 2 alarm đang hiện (khu vực Bồn)?');
    src.set([...LIST(), inst({ id: 'NEW', area: 'bon', rev: 900 })], { revision: 900 }); // alarm mới sau khi mở hộp
    await frame();
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(host.ackCalls).toHaveLength(1);
    expect(host.ackCalls[0]).toEqual({
      all: true,
      upToRevision: 500,
      filter: { areas: ['bon'], states: ['ACTIVE_UNACK', 'RTN_UNACK'] },
    });
    expect(dlg()).toBeNull();
  });
  it('hủy hộp: không gửi; Esc đóng và trả focus về nút gọi', async () => {
    const { page, host } = setup();
    const b = btn(page, 'ackall');
    b.focus();
    b.click();
    await frame();
    dlg()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await frame();
    expect(dlg()).toBeNull();
    expect(host.ackCalls).toHaveLength(0);
    expect(document.activeElement).toBe(b);
  });
  it('skippedNewer > 0: hiện "n alarm mới bật chưa được xác nhận"; kết quả theo mục', async () => {
    const { page, host } = setup();
    host.ackHandler = () => ({
      ok: true,
      acked: 1,
      skippedNewer: 2,
      results: [
        { id: 'A', occurrence: 11, result: 'ACKED' },
        { id: 'B', occurrence: 12, result: 'ALREADY_ACKED' },
      ],
    });
    btn(page, 'ackall').click();
    await frame();
    dlg()!.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    const msg = text(table(page).shadowRoot.querySelector('[data-msg]'));
    expect(msg).toContain('Đã xác nhận: 1');
    expect(msg).toContain('Đã được xác nhận: 1');
    expect(msg).toContain('2 alarm mới bật chưa được xác nhận');
  });
  it('lỗi AUDIT_UNAVAILABLE: dải lỗi tiếng Việt, giữ lựa chọn và bộ lọc', async () => {
    const { page, host } = setup();
    host.ackHandler = () => ({
      ok: false,
      error: { code: 'AUDIT_UNAVAILABLE', message: 'x' },
      results: [],
      acked: 0,
      skippedNewer: 0,
    });
    await setSel(page, 'area', 'bon');
    check(page, 'A');
    await frame();
    btn(page, 'ack').click();
    await frame();
    expect(text(table(page).shadowRoot.querySelector('[data-msg]'))).toContain(
      'không ghi được nhật ký kiểm toán',
    );
    expect(sel(page, 'area').value).toBe('bon');
    expect(text(page.el.querySelector('[data-sel]'))).toBe('1 hàng đã chọn');
  });
  it('STALE hiện nhấn mạnh; 401 mở hộp đăng nhập (host lo) và giữ bộ lọc', async () => {
    const { page, host } = setup();
    host.ackHandler = () => ({
      ok: true,
      acked: 0,
      skippedNewer: 0,
      results: [{ id: 'A', occurrence: 11, result: 'STALE' }],
    });
    await frame();
    check(page, 'A');
    await frame();
    btn(page, 'ack').click();
    await frame();
    expect(text(table(page).shadowRoot.querySelector('[data-msg]'))).toContain(
      'Alarm đã bật lại lần mới',
    );
    host.ackHandler = () => ({
      ok: false,
      error: { code: 'SESSION_EXPIRED', message: '' },
      results: [],
      acked: 0,
      skippedNewer: 0,
    });
    await setSel(page, 'cls', 'critical');
    btn(page, 'ack').click();
    await frame();
    expect(sel(page, 'cls').value).toBe('critical');
  });
});

describe('viewer khóa (US1 kịch bản 8)', () => {
  it('vẫn thấy đủ bảng và bộ lọc; nút khóa kèm lý do; không gọi host', async () => {
    const host = new FakeActionHost({ session: { user: 'xem1', role: 'viewer' } });
    const { page } = setup(host);
    await frame();
    expect(rowIds(page)).toEqual(['A', 'B', 'C', 'D']);
    check(page, 'A');
    await frame();
    const b = btn(page, 'ack');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(text(page.el.querySelector('[data-lock]'))).toBe('Cần đăng nhập với role operator');
    b.click();
    btn(page, 'ackall').click();
    await frame();
    expect(host.ackCalls).toHaveLength(0);
    expect(dlg()).toBeNull();
  });
  it('chưa đăng nhập: bấm nút mở hộp đăng nhập', async () => {
    const host = new FakeActionHost({ session: null });
    const { page } = setup(host);
    btn(page, 'ack').click();
    expect(host.calls).toContain('login');
  });
  it('mất kết nối: khóa với lý do mất kết nối', async () => {
    const { page, src } = setup();
    src.setStatus('stale');
    await frame();
    expect(text(page.el.querySelector('[data-lock]'))).toBe('Mất kết nối tới thiết bị');
  });
});

describe('tạm ẩn (US3 kịch bản 10)', () => {
  const open = async (page: AlarmPage, id = 'B') => {
    await frame();
    check(page, id);
    await frame();
    btn(page, 'shelve').click();
    await frame();
    return dlg()!;
  };
  it('hộp có lý do bắt buộc (đếm ký tự) và thời lượng mặc định 1 giờ', async () => {
    const { page } = setup();
    const d = await open(page);
    expect(d.getAttribute('aria-label')).toBe('Tạm ẩn alarm');
    expect(text(d)).toContain('Alarm vẫn được ghi lịch sử nhưng không hiện ở banner');
    const pressed = d.querySelector('[aria-pressed="true"]')!;
    expect(text(pressed)).toBe('1 giờ');
    const reason = d.querySelector<HTMLInputElement>('input[data-f="reason"]')!;
    reason.value = 'Đang sửa';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    expect(text(d.querySelector('[data-count]'))).toBe('8 / 120');
    expect(reason.maxLength).toBe(120);
  });
  it('thiếu lý do: không gửi, hiện lỗi ở ô; đủ thì gửi {id, reason, durationS}', async () => {
    const { page, host } = setup();
    const d = await open(page);
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(host.shelveCalls).toHaveLength(0);
    expect(text(d.querySelector('[data-err="reason"]'))).toContain('Nhập lý do');
    const reason = d.querySelector<HTMLInputElement>('input[data-f="reason"]')!;
    reason.value = '  Đang sửa chữa  ';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelectorAll<HTMLButtonElement>('[data-dur]')[2]!.click(); // 4 giờ
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(host.shelveCalls).toEqual([{ id: 'B', reason: 'Đang sửa chữa', durationS: 4 * 3600 }]);
    expect(dlg()).toBeNull();
  });
  it('nhập số phút 1..480 thay cho nút; ngoài khoảng báo lỗi', async () => {
    const { page, host } = setup();
    const d = await open(page);
    const reason = d.querySelector<HTMLInputElement>('input[data-f="reason"]')!;
    reason.value = 'x';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    const min = d.querySelector<HTMLInputElement>('input[data-f="minutes"]')!;
    min.value = '999';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(host.shelveCalls).toHaveLength(0);
    expect(text(d.querySelector('[data-err="minutes"]'))).toContain('1 đến 480');
    min.value = '30';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(host.shelveCalls[0]!.durationS).toBe(1800);
  });
  it('SHELVE_RANGE từ máy chủ hiện ngay ở ô tương ứng (field), hộp vẫn mở', async () => {
    const { page, host } = setup();
    host.shelveHandler = () => ({
      ok: false,
      error: { code: 'SHELVE_RANGE', message: 'x', field: 'reason' },
    });
    const d = await open(page);
    const reason = d.querySelector<HTMLInputElement>('input[data-f="reason"]')!;
    reason.value = 'ok';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelector<HTMLButtonElement>('button[data-act="confirm"]')!.click();
    await frame();
    expect(dlg()).not.toBeNull();
    expect(text(d.querySelector('[data-err="reason"]'))).toContain('Lý do 1 đến 120 ký tự');
  });
  it('phím S trên hàng mở hộp; nút Tạm ẩn… cần đúng một hàng chọn', async () => {
    const { page } = setup();
    btn(page, 'shelve').click(); // chưa chọn gì
    await frame();
    expect(dlg()).toBeNull();
    table(page).dispatchEvent(
      new CustomEvent('mat-alarm-shelve', { detail: { id: 'A' }, bubbles: true }),
    );
    await frame();
    expect(text(dlg()!.querySelector('[data-alarm]'))).toContain('Mức bồn cao');
  });
  it('tab Tạm ẩn: Gỡ tạm ẩn gọi host', async () => {
    const { page, host } = setup();
    page.el.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
    await frame();
    table(page).shadowRoot.querySelector<HTMLButtonElement>('button[data-act="unshelve"]')!.click();
    await frame();
    expect(host.unshelveCalls).toEqual(['S']);
  });
});

describe('an toàn DOM', () => {
  it('chuỗi project trong hộp tạm ẩn và xác nhận hiện dạng chữ', async () => {
    const evil = '<img src=x onerror=1>';
    const host = new FakeActionHost({ session: { user: 'a', role: 'operator' } });
    const src = new MemoryAlarmSource({
      instances: [inst({ id: 'E', text: evil, name: evil })],
      classes: CLASSES,
      areas: AREAS,
    });
    const page = new AlarmPage({ source: src, host });
    document.body.append(page.el);
    page.show();
    await frame();
    table(page).dispatchEvent(
      new CustomEvent('mat-alarm-shelve', { detail: { id: 'E' }, bubbles: true }),
    );
    await frame();
    expect(document.body.querySelector('img')).toBeNull();
    expect(text(dlg())).toContain(evil);
  });
});
