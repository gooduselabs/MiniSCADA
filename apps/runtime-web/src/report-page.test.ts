// T103: trang #/report/<id>: chọn kỳ, Xem, bảng cố định đầu, dòng tổng, thiếu dữ liệu, bốn nút xuất (không gọi lại
// thiết bị khi xuất), trạng thái FR-035, đường dẫn ?d=/?m=, chữ thuần.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReport, parseUtcOffset, reportRequest, type ReportTable } from '@mat/history-math';
import {
  FakeHistorySource,
  HistoryError,
  type AggregateQuery,
  type AggregateResult,
} from '@mat/ui-components';
import type { ExportMeta } from '@mat/report-export';
import { ReportPage, type ReportsFile } from './report-page.ts';

const NOW = Date.UTC(2026, 9, 12, 8, 30, 0); // 15:30 +07:00 ngày 2026-10-12
const TZ = '+07:00';

const FILE: ReportsFile = {
  reports: [
    {
      id: 'dien-ca',
      name: 'Điện năng theo ca',
      group: 'dien',
      period: 'shift',
      shifts: { count: 3, start: '06:00' },
      title: 'BÁO CÁO ĐIỆN NĂNG THEO CA',
      footer: 'Phòng Kỹ thuật',
      totals: true,
      columns: [
        {
          tagId: 'METER1.KWH',
          label: 'Điện năng',
          unit: 'kWh',
          decimals: 1,
          functions: ['delta', 'max'],
        },
        { tagId: 'METER1.KW', label: 'Công suất', unit: 'kW', decimals: 1, functions: ['avg'] },
      ],
    },
    {
      id: 'dien-ngay',
      name: 'Điện năng <script>x</script>',
      group: 'dien',
      period: 'day',
      rowMinutes: 60,
      columns: [{ tagId: 'METER1.KWH', functions: ['delta'] }],
    },
    {
      id: 'dien-thang',
      name: 'Điện năng theo tháng',
      group: 'dien',
      period: 'month',
      columns: [{ tagId: 'METER1.KWH', functions: ['delta'] }],
    },
  ],
};

/** Mỗi cửa sổ k: first = 100k, last = 100k + 10, n = 60; cửa sổ chỉ có nửa dữ liệu nếu `thin(k)`. */
function aggFor(thin: (k: number) => boolean = () => false) {
  return (q: AggregateQuery): AggregateResult => {
    const off = q.offsetMs ?? 0;
    const start = Math.floor((q.from - off) / q.bucketMs) * q.bucketMs + off;
    const count = Math.ceil((q.to - start) / q.bucketMs);
    const col = <T>(f: (k: number) => T): T[] => Array.from({ length: count }, (_, k) => f(k));
    return {
      group: q.group,
      timeZone: TZ,
      from: q.from,
      to: q.to,
      bucketMs: q.bucketMs,
      offsetMs: off,
      start,
      count,
      source: 'hour',
      series: q.tags.map((tagId) => ({
        tagId,
        n: col(() => 60),
        min: col((k) => 100 * k),
        max: col((k) => 100 * k + 10),
        first: col((k) => 100 * k),
        last: col((k) => 100 * k + 10),
        sumw: col((k) => 50 * (thin(k) ? q.bucketMs / 2 : q.bucketMs)),
        wms: col((k) => (thin(k) ? q.bucketMs / 2 : q.bucketMs)),
        avg: col(() => 50),
        sum: col(() => 0),
      })),
    };
  };
}

interface Ctx {
  root: HTMLElement;
  hist: FakeHistorySource;
  page: ReportPage;
  urls: string[];
  downloads: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  exported: Array<{ kind: string; table: ReportTable; meta?: ExportMeta }>;
}

function setup(file: ReportsFile | null = FILE, now = NOW): Ctx {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.id = 'dien';
  hist.catalogData.groups[0]!.timeZone = TZ;
  hist.aggregateFn = aggFor();
  const root = document.createElement('div');
  document.body.append(root);
  const urls: string[] = [];
  const downloads: Ctx['downloads'] = [];
  const exported: Ctx['exported'] = [];
  const page = new ReportPage({
    container: root,
    history: hist,
    now: () => now,
    loadReports: async () => file,
    userName: () => 'xem1',
    tagInfo: (id) => (id === 'METER1.KW' ? { description: 'Công suất', unit: 'kW' } : undefined),
    onUrl: (h) => urls.push(h),
    download: (name, mime, bytes) => downloads.push({ name, mime, bytes }),
    exporter: {
      csv: (t, _l, style) => {
        exported.push({ kind: `csv-${style}`, table: t });
        return new Uint8Array([1, 2, 3]);
      },
      xlsx: async (t, meta) => {
        exported.push({ kind: 'xlsx', table: t, meta });
        return new Uint8Array([4]);
      },
      pdf: async (t, meta) => {
        exported.push({ kind: 'pdf', table: t, meta });
        return new Uint8Array([5]);
      },
    },
  });
  return { root, hist, page, urls, downloads, exported };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

const btn = (root: HTMLElement, cls: string) =>
  root.querySelector<HTMLButtonElement>(`button.${cls}`)!;
/** Phần dựng của <mat-report-view> (feature 015): bảng và chú thích nằm trong shadow root. */
const viewOf = (root: HTMLElement): ParentNode =>
  root.querySelector('mat-report-view')?.shadowRoot ?? document.createDocumentFragment();
const rowsOf = (root: HTMLElement) => [...viewOf(root).querySelectorAll('table.rpt tbody tr')];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('ReportPage: chọn kỳ và Xem', () => {
  it('mẫu ca: ô ngày mặc định là hôm nay theo giờ nhóm; Xem gọi aggregate theo reportRequest và dựng bảng khớp buildReport', async () => {
    const { root, page, hist } = setup();
    await page.show('dien-ca', new URLSearchParams());
    await flush();
    const input = root.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input.value).toBe('2026-10-12');
    btn(root, 'view').click();
    await flush();
    const tpl = FILE.reports[0]!;
    const req = reportRequest(tpl as never, { d: '2026-10-12' }, parseUtcOffset(TZ));
    expect(hist.aggregateCalls.length).toBe(1);
    expect(hist.aggregateCalls[0]).toMatchObject({
      group: 'dien',
      from: req.from,
      to: req.to,
      bucketMs: req.bucketMs,
      offsetMs: req.offsetMs,
      priority: 'user',
    });
    expect(hist.aggregateCalls[0]!.tags).toEqual(['METER1.KWH', 'METER1.KW']);
    const expected = buildReport({
      template: tpl as never,
      select: { d: '2026-10-12' },
      tz: TZ,
      now: NOW,
      tagInfo: { 'METER1.KW': { description: 'Công suất', unit: 'kW' } },
      aggregates: [aggFor()(hist.aggregateCalls[0]!)],
    });
    const rows = rowsOf(root);
    expect(rows.length).toBe(expected.rows.length + 1); // + dòng tổng
    const first = [...rows[0]!.querySelectorAll('th, td')].map((c) => c.textContent!.trim());
    expect(first[0]).toBe(expected.rows[0]!.label);
    expect(first.slice(1)).toEqual(expected.rows[0]!.text);
    const total = [...rows.at(-1)!.querySelectorAll('th, td')].map((c) => c.textContent!.trim());
    expect(total.slice(1)).toEqual(expected.totalsText);
    expect(rows.at(-1)!.classList.contains('total')).toBe(true);
  });

  it('mẫu ca lúc 01:07: ô ngày mặc định là ngày làm việc đang chạy (hôm trước, ca 1 bắt đầu 06:00)', async () => {
    // 2026-10-13 01:07 +07:00: ngày làm việc 13 bắt đầu lúc 06:00, chưa tới; đang chạy là ngày làm việc 12.
    const { root, page } = setup(FILE, Date.UTC(2026, 9, 12, 18, 7, 0));
    await page.show('dien-ca', new URLSearchParams());
    await flush();
    expect(root.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-10-12');
  });

  it('hàng "chưa tới" (kỳ đang chạy) hiện chữ, không số', async () => {
    const { root, page } = setup();
    await page.show('dien-ca', new URLSearchParams());
    btn(root, 'view').click();
    await flush();
    // 15:30: ca 3 (22:00 → 06:00) chưa tới
    const last = rowsOf(root)[2]!;
    expect(last.textContent).toContain('chưa tới');
    expect(last.querySelector('td.pending')).not.toBeNull();
  });

  it('thiếu dữ liệu (coverage < 95 %) tô ô và hiện "Dữ liệu đủ X %"', async () => {
    const { root, page, hist } = setup();
    hist.aggregateFn = aggFor((k) => k === 0);
    await page.show('dien-ca', new URLSearchParams());
    btn(root, 'view').click();
    await flush();
    expect(rowsOf(root)[0]!.querySelector('td.miss')).not.toBeNull();
    expect(viewOf(root).querySelector('.coverage')!.textContent).toMatch(/Dữ liệu đủ \d+/);
  });

  it('đường dẫn ?d= giữ kỳ khi F5 và Xem ghi lại đường dẫn; tháng dùng ?m=', async () => {
    const { root, page, urls } = setup();
    await page.show('dien-ca', new URLSearchParams('d=2026-10-05'));
    expect(root.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-10-05');
    btn(root, 'view').click();
    await flush();
    expect(urls.at(-1)).toBe('#/report/dien-ca?d=2026-10-05');
    root.replaceChildren();
    await page.show('dien-thang', new URLSearchParams('m=2026-09'));
    expect(root.querySelector<HTMLInputElement>('input[type="month"]')!.value).toBe('2026-09');
    btn(root, 'view').click();
    await flush();
    expect(urls.at(-1)).toBe('#/report/dien-thang?m=2026-09');
    expect(rowsOf(root).length).toBe(30 + 1);
  });

  it('kỳ sai trong đường dẫn bị bỏ, dùng mặc định', async () => {
    const { root, page } = setup();
    await page.show('dien-ca', new URLSearchParams('d=khong-phai-ngay'));
    expect(root.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-10-12');
  });

  it('có ?d= thì tự dựng báo cáo (F5 cho cùng bảng)', async () => {
    const { root, page } = setup();
    await page.show('dien-ca', new URLSearchParams('d=2026-10-05'));
    await flush();
    expect(rowsOf(root).length).toBeGreaterThan(0);
  });

  it('mẫu không có: thông báo; tên mẫu chứa mã HTML hiện thành chữ', async () => {
    const { root, page } = setup();
    await page.show('khong-co', new URLSearchParams());
    expect(root.textContent).toContain('Không có mẫu báo cáo "khong-co"');
    await page.show('dien-ngay', new URLSearchParams());
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('h2')!.textContent).toBe('Điện năng <script>x</script>');
  });

  it('không có reports.json: "chưa có mẫu"', async () => {
    const { root, page } = setup(null);
    await page.show('dien-ca', new URLSearchParams());
    expect(root.textContent).toContain('chưa có mẫu báo cáo');
  });
});

describe('ReportPage: xuất file', () => {
  async function ready() {
    const c = setup();
    await c.page.show('dien-ca', new URLSearchParams('d=2026-10-12'));
    btn(c.root, 'view').click();
    await flush();
    return c;
  }

  it('bốn nút xuất dựng từ cùng ReportTable, tên file <id>_<kỳ>.<đuôi>, không gọi lại thiết bị', async () => {
    const { root, hist, downloads, exported } = await ready();
    const calls = hist.aggregateCalls.length + hist.seriesCalls.length + hist.rowsCalls.length;
    for (const k of ['csv', 'csv-vi', 'xlsx', 'pdf']) {
      btn(root, k).click();
      await flush();
    }
    expect(exported.map((e) => e.kind)).toEqual(['csv-standard', 'csv-excel-vi', 'xlsx', 'pdf']);
    expect(new Set(exported.map((e) => e.table)).size).toBe(1); // cùng một bảng
    expect(downloads.map((d) => d.name)).toEqual([
      'dien-ca_2026-10-12.csv',
      'dien-ca_2026-10-12.csv',
      'dien-ca_2026-10-12.xlsx',
      'dien-ca_2026-10-12.pdf',
    ]);
    expect(downloads[2]!.mime).toContain('spreadsheetml');
    expect(hist.aggregateCalls.length + hist.seriesCalls.length + hist.rowsCalls.length).toBe(
      calls,
    );
  });

  it('XLSX và PDF không nhận chủ đề nữa (feature 029: một giao diện), kể cả khi trang còn data-mat-theme cũ', async () => {
    document.documentElement.dataset.matTheme = 'dark';
    const { root, exported } = await ready();
    for (const k of ['xlsx', 'pdf']) {
      btn(root, k).click();
      await flush();
    }
    expect(exported.map((e) => e.meta?.theme)).toEqual([undefined, undefined]);
    root.remove();
    delete document.documentElement.dataset.matTheme;
  });

  it('nút xuất tắt khi chưa có báo cáo; lỗi dựng XLSX báo cụ thể, CSV vẫn dùng được', async () => {
    const c = setup();
    await c.page.show('dien-ca', new URLSearchParams());
    expect(btn(c.root, 'xlsx').disabled).toBe(true);
    const page2 = new ReportPage({
      container: c.root,
      history: c.hist,
      now: () => NOW,
      loadReports: async () => FILE,
      userName: () => 'u',
      onUrl: () => {},
      download: (n, m, b) => c.downloads.push({ name: n, mime: m, bytes: b }),
      exporter: {
        csv: () => new Uint8Array([1]),
        xlsx: async () => {
          throw new Error('hỏng');
        },
        pdf: async () => new Uint8Array([2]),
      },
    });
    await page2.show('dien-ca', new URLSearchParams('d=2026-10-12'));
    btn(c.root, 'view').click();
    await flush();
    btn(c.root, 'xlsx').click();
    await flush();
    expect(c.root.querySelector('[role="alert"]')!.textContent).toContain('Không xuất được XLSX');
    btn(c.root, 'csv').click();
    await flush();
    expect(c.downloads.length).toBe(1);
  });
});

describe('ReportPage: trạng thái FR-035', () => {
  it('chưa đăng nhập: chữ + nút Đăng nhập', async () => {
    const { root, page, hist } = setup();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    await page.show('dien-ca', new URLSearchParams());
    await flush();
    expect(root.textContent).toContain('Đăng nhập để xem báo cáo');
    root.querySelector<HTMLButtonElement>('button.login')!.click();
    expect(hist.loginRequests).toBe(1);
  });

  it('Xem khi bị 401 hiện đăng nhập; khi lỗi thiết bị hiện lỗi + thử lại', async () => {
    const { root, page, hist } = setup();
    await page.show('dien-ca', new URLSearchParams());
    hist.failWith = new HistoryError('HISTORY_UNAVAILABLE', 'x', 503);
    btn(root, 'view').click();
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Không tải được');
    hist.failWith = null;
    root.querySelector<HTMLButtonElement>('button.retry')!.click();
    await flush();
    expect(rowsOf(root).length).toBeGreaterThan(0);
  });

  it('kỳ tháng quá lớn (RANGE_TOO_LARGE): báo thu hẹp kỳ', async () => {
    const { root, page, hist } = setup();
    await page.show('dien-thang', new URLSearchParams('m=2026-09'));
    hist.failWith = new HistoryError('RANGE_TOO_LARGE', 'quá lớn', 422);
    btn(root, 'view').click();
    await flush();
    expect(root.textContent).toContain('thu hẹp kỳ');
  });

  it('chưa bật lưu trữ; nhóm của mẫu không có trong catalog', async () => {
    const a = setup();
    a.hist.catalogData.enabled = false;
    await a.page.show('dien-ca', new URLSearchParams());
    await flush();
    expect(a.root.textContent).toContain('Chưa bật lưu trữ');
    document.body.replaceChildren();
    const b = setup();
    b.hist.catalogData.groups[0]!.id = 'khac';
    await b.page.show('dien-ca', new URLSearchParams());
    await flush();
    expect(b.root.textContent).toContain('nhóm');
  });

  it('kỳ chưa có dữ liệu: "Kỳ này chưa có dữ liệu"', async () => {
    const { root, page, hist } = setup();
    hist.aggregateFn = (q) => {
      const r = aggFor()(q);
      for (const s of r.series) {
        s.n.fill(0);
        s.wms.fill(0);
        for (const k of ['min', 'max', 'first', 'last', 'sumw', 'avg', 'sum'] as const)
          s[k].fill(null as never);
      }
      return r;
    };
    await page.show('dien-ca', new URLSearchParams('d=2026-10-05'));
    await flush();
    expect(root.textContent).toContain('Kỳ này chưa có dữ liệu');
  });

  describe('hủy yêu cầu đang bay (I4 phía client)', () => {
    async function pending() {
      const c = setup();
      const signals: AbortSignal[] = [];
      c.hist.aggregate = (_q, signal) => {
        signals.push(signal);
        return new Promise(() => {}); // không bao giờ xong
      };
      await c.page.show('dien-ca', new URLSearchParams());
      await flush();
      return { ...c, signals };
    }
    it('Xem lại hủy yêu cầu trước', async () => {
      const { root, signals } = await pending();
      btn(root, 'view').click();
      await flush();
      btn(root, 'view').click();
      await flush();
      expect(signals.length).toBe(2);
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);
    });
    it('dispose hủy yêu cầu đang bay', async () => {
      const { root, page, signals } = await pending();
      btn(root, 'view').click();
      await flush();
      page.dispose();
      expect(signals[0]!.aborted).toBe(true);
    });
    it('hide (rời trang) hủy yêu cầu đang bay', async () => {
      const { root, page, signals } = await pending();
      btn(root, 'view').click();
      await flush();
      page.hide();
      expect(signals[0]!.aborted).toBe(true);
    });
  });

  it('dispose dọn DOM, không ném lỗi khi trạng thái đổi sau đó', async () => {
    const { root, page, hist } = setup();
    await page.show('dien-ca', new URLSearchParams());
    page.dispose();
    expect(root.childElementCount).toBe(0);
    hist.setState('busy');
  });
});
