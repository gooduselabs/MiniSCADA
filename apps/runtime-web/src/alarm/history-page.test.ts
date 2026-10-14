// Trang Lịch sử alarm #/alarm-history (feature 009, FR-060; US4 kịch bản 1, 2, 5, 6; contracts/ui-alarm.md §12).
import { MemoryAlarmSource } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryItem } from './csv.ts';
import { HistoryPage, buildHistoryQuery } from './history-page.ts';

const NOW = Date.UTC(2026, 9, 13, 1, 0, 0);
const frame = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));
afterEach(() => document.body.replaceChildren());

const item = (id: number, over: Partial<HistoryItem> = {}): HistoryItem => ({
  id,
  alarmId: `AL_${id}`,
  name: `Tên ${id}`,
  class: 'major',
  priority: 'major',
  area: 'bon',
  text: `Nội dung ${id}`,
  valueActive: id,
  qualityActive: 'GOOD',
  reason: null,
  tsActive: NOW - id * 60_000,
  clockOk: true,
  tsAck: null,
  ackUser: null,
  tsReturn: NOW - id * 60_000 + 30_000,
  tsReturnAck: null,
  returnAckUser: null,
  flags: { startup: false, inputBad: false },
  closedBy: 'return',
  state: 'closed',
  ...over,
});

interface Reply {
  status?: number;
  body: unknown;
}
function setup(replies: Reply[] | ((url: URL) => Reply)) {
  const urls: URL[] = [];
  let n = 0;
  const fetchFn = ((input: string) => {
    const u = new URL(input, 'http://x');
    urls.push(u);
    const r =
      typeof replies === 'function' ? replies(u) : replies[Math.min(n++, replies.length - 1)]!;
    return Promise.resolve({
      ok: (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body),
    });
  }) as unknown as typeof fetch;
  const src = new MemoryAlarmSource({
    instances: [inst()],
    classes: CLASSES,
    areas: AREAS,
    now: NOW,
  });
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let tid = 0;
  const downloads: Array<{ name: string; blob: Blob }> = [];
  const page = new HistoryPage({
    source: src,
    fetch: fetchFn,
    setTimer: (fn, ms) => {
      const my = ++tid;
      timers.push({
        fn: () => {
          timers.splice(
            timers.findIndex((x) => x.id === my),
            1,
          );
          fn();
        },
        ms,
        id: my,
      });
      return my;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    download: (blob, name) => downloads.push({ blob, name }),
  });
  document.body.append(page.el);
  page.show();
  return { page, urls, src, timers, downloads };
}
const ok = (items: HistoryItem[], hasMore = false, next: number | null = null): Reply => ({
  body: { items, limit: 100, hasMore, nextBeforeId: next, ts: NOW },
});
const rows = (p: HistoryPage) => [...p.el.querySelectorAll<HTMLElement>('tbody tr')];
const cells = (tr: Element) =>
  [...tr.querySelectorAll('td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
const q = (p: HistoryPage, sel: string) => p.el.querySelector<HTMLElement>(sel)!;
const setVal = async (el: HTMLInputElement | HTMLSelectElement, v: string, ev = 'change') => {
  el.value = v;
  el.dispatchEvent(new Event(ev, { bubbles: true }));
  await frame();
};

describe('buildHistoryQuery', () => {
  it('thứ tự cố định; bỏ khóa trống', () => {
    expect(buildHistoryQuery({ from: 1, to: 2, limit: 100 })).toBe('from=1&to=2&limit=100');
    expect(
      buildHistoryQuery({
        from: 1,
        to: 2,
        limit: 500,
        beforeId: 9,
        area: '-',
        priority: 'major',
        state: 'closed',
        alarmId: 'A.B',
        q: 'bồn',
      }),
    ).toBe(
      'from=1&to=2&limit=500&beforeId=9&area=-&priority=major&state=closed&alarmId=A.B&q=b%E1%BB%93n',
    );
  });
});

describe('tải trang đầu và khoảng nhanh (US4 kịch bản 1)', () => {
  it('mặc định 24 giờ theo giờ thiết bị, 100 dòng', async () => {
    const t = setup([ok([item(1), item(2)])]);
    await frame();
    expect(t.urls).toHaveLength(1);
    const u = t.urls[0]!;
    expect(u.pathname).toBe('/api/v1/alarms/history');
    expect(u.searchParams.get('limit')).toBe('100');
    expect(Number(u.searchParams.get('to'))).toBe(NOW);
    expect(Number(u.searchParams.get('from'))).toBe(NOW - 24 * 3600_000);
    expect(rows(t.page)).toHaveLength(2);
    expect(q(t.page, '[data-range="24h"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('chọn khoảng nhanh: 1 giờ, 8 giờ, 7 ngày, 30 ngày', async () => {
    const t = setup([ok([])]);
    await frame();
    for (const [k, ms] of [
      ['1h', 3600_000],
      ['8h', 8 * 3600_000],
      ['7d', 7 * 86_400_000],
      ['30d', 30 * 86_400_000],
    ] as const) {
      q(t.page, `[data-range="${k}"]`).click();
      await frame();
      const u = t.urls.at(-1)!;
      expect(Number(u.searchParams.get('to')) - Number(u.searchParams.get('from'))).toBe(ms);
      expect(q(t.page, `[data-range="${k}"]`).getAttribute('aria-pressed')).toBe('true');
    }
  });
  it('khoảng tùy chọn từ–đến (giờ trình duyệt)', async () => {
    const t = setup([ok([])]);
    await frame();
    const from = new Date(2026, 9, 1, 8, 0);
    const to = new Date(2026, 9, 2, 8, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const loc = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await setVal(q(t.page, 'input[data-f="from"]') as HTMLInputElement, loc(from));
    await setVal(q(t.page, 'input[data-f="to"]') as HTMLInputElement, loc(to));
    const u = t.urls.at(-1)!;
    expect(Number(u.searchParams.get('from'))).toBe(from.getTime());
    expect(Number(u.searchParams.get('to'))).toBe(to.getTime());
    expect(t.page.el.querySelectorAll('[data-range][aria-pressed="true"]')).toHaveLength(0);
  });
  it('quá 366 ngày hoặc từ ≥ đến: không gửi, hiện lý do', async () => {
    const t = setup([ok([])]);
    await frame();
    const n = t.urls.length;
    await setVal(q(t.page, 'input[data-f="from"]') as HTMLInputElement, '2024-01-01T00:00');
    await setVal(q(t.page, 'input[data-f="to"]') as HTMLInputElement, '2026-01-01T00:00');
    expect(t.urls).toHaveLength(n);
    expect(q(t.page, '[data-err]').textContent).toContain('366 ngày');
    await setVal(q(t.page, 'input[data-f="from"]') as HTMLInputElement, '2026-01-02T00:00');
    expect(q(t.page, '[data-err]').textContent).toContain('trước');
  });
});

describe('bộ lọc (FR-060)', () => {
  it('khu vực (kể cả Chung), mức tối thiểu, trạng thái cuối, mã alarm, chữ tìm vào query', async () => {
    const t = setup([ok([])]);
    await frame();
    await setVal(q(t.page, 'select[data-f="area"]') as HTMLSelectElement, '-');
    expect(t.urls.at(-1)!.searchParams.get('area')).toBe('-');
    await setVal(q(t.page, 'select[data-f="priority"]') as HTMLSelectElement, 'major');
    expect(t.urls.at(-1)!.searchParams.get('priority')).toBe('major');
    await setVal(q(t.page, 'select[data-f="state"]') as HTMLSelectElement, 'acked');
    expect(t.urls.at(-1)!.searchParams.get('state')).toBe('acked');
    await setVal(
      q(t.page, 'input[data-f="alarmId"]') as HTMLInputElement,
      'TANK_B1_LEVEL',
      'change',
    );
    expect(t.urls.at(-1)!.searchParams.get('alarmId')).toBe('TANK_B1_LEVEL');
    await setVal(q(t.page, 'input[type="search"]') as HTMLInputElement, 'bồn', 'change');
    expect(t.urls.at(-1)!.searchParams.get('q')).toBe('bồn');
  });
  it('đổi bộ lọc đưa về trang đầu (bỏ beforeId, xóa dòng cũ)', async () => {
    const t = setup([ok([item(5), item(4)], true, 4), ok([item(3)]), ok([item(9)])]);
    await frame();
    q(t.page, 'button[data-act="more"]').click();
    await frame();
    expect(rows(t.page)).toHaveLength(3);
    await setVal(q(t.page, 'select[data-f="state"]') as HTMLSelectElement, 'active');
    expect(t.urls.at(-1)!.searchParams.has('beforeId')).toBe(false);
    expect(rows(t.page)).toHaveLength(1);
  });
});

describe('bảng và sắp xếp trên các trang đã tải', () => {
  it('cột: bật lúc, xác nhận lúc·người, hết lúc, thời lượng, giá trị, ưu tiên, khu vực, nội dung, trạng thái', async () => {
    const t = setup([ok([item(2, { tsAck: NOW, ackUser: 'vanhanh1' })])]);
    await frame();
    const heads = [...t.page.el.querySelectorAll('thead th')].map((h) => h.textContent!.trim());
    expect(heads).toEqual([
      'Bật lúc',
      'Xác nhận lúc · người',
      'Hết lúc',
      'Thời lượng',
      'Giá trị',
      'Ưu tiên',
      'Khu vực',
      'Nội dung',
      'Trạng thái',
    ]);
    const c = cells(rows(t.page)[0]!);
    expect(c[1]).toContain('vanhanh1');
    expect(c[3]).toBe('00:30');
    expect(c[5]).toBe('Quan trọng');
    expect(c[6]).toBe('Bồn');
    expect(c[7]).toBe('Nội dung 2');
    expect(c[8]).toBe('Đã hết');
  });
  it('lần xảy ra chưa hết hiện "Đang có" và thời lượng trống', async () => {
    const t = setup([ok([item(1, { tsReturn: null, state: 'active', closedBy: null })])]);
    await frame();
    const c = cells(rows(t.page)[0]!);
    expect(c[8]).toBe('Đang có');
    expect(c[3]).toBe('');
    expect(c[2]).toBe('');
  });
  it('đóng do đổi cấu hình, vô hiệu, khởi động lại; giờ chưa đồng bộ', async () => {
    const t = setup([
      ok([
        item(1, { closedBy: 'config', tsReturn: null }),
        item(2, { closedBy: 'disabled', tsReturn: null }),
        item(3, { closedBy: 'restart-lost', tsReturn: null }),
        item(4, { clockOk: false }),
      ]),
    ]);
    await frame();
    const st = rows(t.page).map((r) => cells(r)[8]);
    expect(st[0]).toBe('Đóng do đổi cấu hình');
    expect(st[1]).toBe('Đóng do vô hiệu');
    expect(st[2]).toBe('Đóng do khởi động lại');
    expect(cells(rows(t.page)[3]!)[0]).toContain('giờ chưa đồng bộ');
  });
  it('bấm tiêu đề sắp xếp cột trên dữ liệu đã tải (không gọi lại máy chủ)', async () => {
    const t = setup([ok([item(1, { text: 'B' }), item(2, { text: 'A' }), item(3, { text: 'C' })])]);
    await frame();
    const n = t.urls.length;
    q(t.page, 'th button[data-col="text"]').click();
    await frame();
    expect(rows(t.page).map((r) => cells(r)[7])).toEqual(['A', 'B', 'C']);
    expect(t.page.el.querySelector('th[aria-sort]')!.getAttribute('aria-sort')).toBe('ascending');
    q(t.page, 'th button[data-col="text"]').click();
    await frame();
    expect(rows(t.page).map((r) => cells(r)[7])).toEqual(['C', 'B', 'A']);
    expect(t.urls).toHaveLength(n);
    q(t.page, 'th button[data-col="value"]').click();
    await frame();
    expect(rows(t.page).map((r) => cells(r)[4])).toEqual(['1', '2', '3']);
  });
  it('mặc định mới nhất trước (đúng thứ tự máy chủ trả)', async () => {
    const t = setup([ok([item(1), item(2), item(3)])]);
    await frame();
    expect(rows(t.page).map((r) => cells(r)[7])).toEqual([
      'Nội dung 1',
      'Nội dung 2',
      'Nội dung 3',
    ]);
  });
});

describe('phân trang bằng beforeId (US4 kịch bản 6)', () => {
  it('Tải thêm dùng nextBeforeId, nối dòng, ẩn khi hết', async () => {
    const t = setup([ok([item(9), item(8)], true, 8), ok([item(7)], false, null)]);
    await frame();
    expect(q(t.page, 'button[data-act="more"]').hidden).toBe(false);
    expect(q(t.page, 'button[data-act="more"]').textContent).toContain('100 dòng');
    q(t.page, 'button[data-act="more"]').click();
    await frame();
    expect(t.urls[1]!.searchParams.get('beforeId')).toBe('8');
    expect(rows(t.page)).toHaveLength(3);
    expect(q(t.page, 'button[data-act="more"]').hidden).toBe(true);
    expect(q(t.page, '[data-loaded]').textContent).toBe('Đã tải 3 dòng');
  });
  it('không dùng OFFSET', async () => {
    const t = setup([ok([item(2)], true, 2), ok([])]);
    await frame();
    q(t.page, 'button[data-act="more"]').click();
    await frame();
    expect([...t.urls.at(-1)!.searchParams.keys()]).not.toContain('offset');
  });
});

describe('Theo dõi (US4 kịch bản 5)', () => {
  it('mặc định tắt; bật thì tải lại trang đầu khi nguồn alarm đổi, gộp ≤ 1 lần/2 s', async () => {
    const t = setup([ok([item(1)])]);
    await frame();
    const n = t.urls.length;
    t.src.upsert(inst({ id: 'X' }));
    t.src.flush();
    await frame();
    expect(t.urls).toHaveLength(n); // chưa bật theo dõi
    const follow = q(t.page, 'input[data-f="follow"]') as HTMLInputElement;
    expect(follow.checked).toBe(false);
    follow.checked = true;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    const after = t.urls.length;
    t.src.upsert(inst({ id: 'Y' }));
    t.src.flush();
    await frame();
    expect(t.timers).toHaveLength(1); // hẹn tải lại, chưa gọi ngay
    expect(t.timers[0]!.ms).toBeLessThanOrEqual(2000);
    t.timers[0]!.fn();
    await frame();
    expect(t.urls.length).toBe(after + 1);
    // nhiều thay đổi liền nhau: chỉ hẹn MỘT lần tải lại
    t.src.upsert(inst({ id: 'Z1' }));
    t.src.flush();
    t.src.upsert(inst({ id: 'Z2' }));
    t.src.flush();
    expect(t.timers).toHaveLength(1);
    t.timers[0]!.fn();
    await frame();
    expect(t.urls.length).toBe(after + 2);
    follow.checked = false;
    follow.dispatchEvent(new Event('change', { bubbles: true }));
    t.src.upsert(inst({ id: 'W' }));
    t.src.flush();
    await frame();
    expect(t.timers).toHaveLength(0);
    expect(t.urls.length).toBe(after + 2);
  });
});

describe('lỗi (FR-060)', () => {
  it.each([
    ['BAD_QUERY', 400, 'Bộ lọc không hợp lệ'],
    ['ALARM_HISTORY_BUSY', 503, 'đang bận truy vấn lịch sử'],
    ['ALARM_LOG_UNAVAILABLE', 503, 'Kho lịch sử alarm chưa sẵn sàng'],
  ])('%s hiện chữ tiếng Việt', async (code, status, want) => {
    const t = setup([{ status, body: { error: code, message: 'en' } }]);
    await frame();
    expect(q(t.page, '[data-err]').textContent).toContain(want);
    expect(q(t.page, '[data-err]').getAttribute('role')).toBe('alert');
  });
  it('mã lạ: hiện mã; lỗi mạng: không kết nối được', async () => {
    const a = setup([{ status: 500, body: { error: 'LẠ' } }]);
    await frame();
    expect(q(a.page, '[data-err]').textContent).toContain('LẠ');
    document.body.replaceChildren();
    const fail = setup(() => {
      throw new Error('net');
    });
    await frame();
    expect(q(fail.page, '[data-err]').textContent).toContain('Không kết nối được');
  });
});

describe('an toàn DOM', () => {
  it('chữ nguy hiểm hiện nguyên văn', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const t = setup([ok([item(1, { text: evil, name: evil, ackUser: evil })])]);
    await frame();
    expect(t.page.el.querySelector('img')).toBeNull();
    expect(cells(rows(t.page)[0]!)[7]).toBe(evil);
  });
});

describe('xuất CSV (US4 kịch bản 3)', () => {
  it('lấy trang 500 dòng theo bộ lọc hiện hành, tải file đúng tên, có BOM', async () => {
    const t = setup((u) =>
      u.searchParams.get('limit') === '500' ? ok([item(3), item(2)]) : ok([item(1)]),
    );
    await frame();
    await setVal(q(t.page, 'select[data-f="state"]') as HTMLSelectElement, 'closed');
    q(t.page, 'button[data-act="csv"]').click();
    await frame(80);
    const csvUrl = t.urls.find((u) => u.searchParams.get('limit') === '500')!;
    expect(csvUrl.searchParams.get('state')).toBe('closed');
    expect(t.downloads).toHaveLength(1);
    expect(t.downloads[0]!.name).toMatch(/^alarm-history-\d{8}T\d{4}-\d{8}T\d{4}\.csv$/);
    const bytes = new Uint8Array(await t.downloads[0]!.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('lỗi trong lúc xuất: hiện lỗi, không tải file', async () => {
    const t = setup((u) =>
      u.searchParams.get('limit') === '500'
        ? { status: 503, body: { error: 'ALARM_LOG_UNAVAILABLE' } }
        : ok([item(1)]),
    );
    await frame();
    q(t.page, 'button[data-act="csv"]').click();
    await frame(80);
    expect(t.downloads).toHaveLength(0);
    expect(q(t.page, '[data-err]').textContent).toContain('Kho lịch sử alarm chưa sẵn sàng');
  });
});
