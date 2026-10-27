// T129 (feature 010, US8; contracts/studio-010.md §2): khung Xem trước báo cáo của editor Mẫu báo cáo. Dựng bảng bằng `buildReport` từ
// nguồn lịch sử chọn được (mô phỏng, thiết bị), cập nhật ≤ 300 ms khi đổi hàm hoặc thứ tự cột (SC-020), lỗi thiết bị (đăng nhập,
// bận, quá lớn), nút xuất thử bốn định dạng qua `report-export` rồi lưu bằng lệnh của Tauri (giả).
import {
  buildReport,
  reportRequest,
  type AggregateResult as MathAggregate,
  type ReportTable,
} from '@mat/history-math';
import { exportCsv, exportXlsx, type ExportMeta } from '@mat/report-export';
import type { ReportTemplate } from '@mat/history-math';
import {
  HistoryError,
  FakeHistorySource,
  setEChartsLoader,
  type HistorySource,
} from '@mat/ui-components';
import { SimHistorySource } from '@mat/tag-sim';
import type { ReportsConfig } from '@mat/project-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simHistoryGroups } from '../model/sim-history-groups.ts';
import { loggingOf, newHistoryApp, reportsOf } from './history-test-helpers.ts';
import './report-preview.ts';
import { projectTheme, type ReportPreview } from './report-preview.ts';
import { cleanup } from './test-helpers.ts';

// ECharts thật nạp chậm trong jsdom: bộ nạp giả (biểu đồ không phải đối tượng của test này).
beforeEach(() =>
  setEChartsLoader(async () => ({
    init: () => ({ setOption() {}, resize() {}, dispose() {} }),
  })),
);
afterEach(() => {
  setEChartsLoader(null);
  cleanup();
});

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const DAY = { d: '2026-10-12' };
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function setup(over: Partial<ReportPreview> = {}) {
  const { app } = await newHistoryApp();
  const logging = loggingOf(app);
  const tags = app.store.state.outline.tags!;
  const source: HistorySource = new SimHistorySource({
    groups: simHistoryGroups(logging, tags),
    now: () => NOW,
    gaps: false,
  });
  const reports = reportsOf(app);
  const el = document.createElement('mat-report-preview') as ReportPreview;
  Object.assign(el, {
    template: reports.reports[0],
    source,
    period: DAY,
    now: () => NOW,
    userName: 'kysu1',
    tagInfo: (id: string) => {
      const t = (
        tags.tags as unknown as Array<{ id: string; description?: string; unit?: string }>
      ).find((x) => x.id === id);
      return t
        ? {
            ...(t.description ? { description: t.description } : {}),
            ...(t.unit ? { unit: t.unit } : {}),
          }
        : undefined;
    },
    save: vi.fn(async () => 'saved' as const),
    ...over,
  });
  document.body.append(el);
  await el.whenIdle();
  return { el, source, reports, app, tags, logging };
}

/** Bảng nằm trong shadow root của <mat-report-view> (feature 015, cùng thành phần với trang vận hành). */
const view = (el: Element): ParentNode =>
  el.querySelector('mat-report-view')?.shadowRoot ?? document.createDocumentFragment();
const rows = (el: Element) => [...view(el).querySelectorAll('table.rpt tbody tr')];
const heads = (el: Element) =>
  [...view(el).querySelectorAll('table.rpt thead th')].map((th) => norm(th.textContent));

describe('mat-report-preview', () => {
  it('dựng bảng từ nguồn mô phỏng: 24 hàng giờ, cột theo (cột mẫu, hàm), dòng tổng, độ phủ; khớp buildReport', async () => {
    const { el, source, reports, tags } = await setup();
    expect(rows(el)).toHaveLength(25); // 24 giờ + dòng tổng
    expect(heads(el)[0]).toBe('Thời gian');
    expect(heads(el).slice(1)).toEqual([
      'Điện năng (kWh) · chênh lệch',
      'Điện năng (kWh) · lớn nhất',
      'Công suất (kW) · trung bình',
      'Công suất (kW) · lớn nhất',
    ]);
    expect(norm(view(el).querySelector('.coverage')?.textContent)).toContain('Dữ liệu đủ');
    // So với việc dựng trực tiếp bằng history-math trên cùng nguồn: cùng từng ô.
    const tpl = reports.reports[0]!;
    const req = reportRequest(tpl as never, DAY, 7 * 3_600_000);
    const aggs = await Promise.all(
      req.batches.map((b) =>
        source.aggregate(
          {
            group: tpl.group!,
            tags: b,
            from: req.from,
            to: req.to,
            bucketMs: req.bucketMs,
            offsetMs: req.offsetMs,
          },
          new AbortController().signal,
        ),
      ),
    );
    const expected = buildReport({
      template: tpl as never,
      select: DAY,
      tz: '+07:00',
      now: NOW,
      aggregates: aggs as unknown as MathAggregate[],
    });
    void tags;
    const texts = rows(el)
      .slice(0, 24)
      .map((r) => [...r.querySelectorAll('td')].map((td) => norm(td.textContent)));
    expect(texts).toEqual(expected.rows.map((r) => r.text));
  });

  it('cập nhật ≤ 300 ms khi đổi hàm hoặc thứ tự cột với dữ liệu mô phỏng (SC-020)', async () => {
    const { el, reports } = await setup();
    const t0 = performance.now();
    const tpl = structuredClone(reports.reports[0]!);
    tpl.columns![0]!.functions = ['min', 'avg'];
    el.template = tpl;
    await el.whenIdle();
    expect(performance.now() - t0).toBeLessThan(300);
    expect(heads(el)[1]).toBe('Điện năng (kWh) · nhỏ nhất');
    const t1 = performance.now();
    const swapped = structuredClone(tpl);
    swapped.columns!.reverse();
    el.template = swapped;
    await el.whenIdle();
    expect(performance.now() - t1).toBeLessThan(300);
    expect(heads(el)[1]).toBe('Công suất (kW) · trung bình');
  });

  it('đổi kỳ: ngày khác đổi nhãn hàng; ca và tháng đúng số hàng', async () => {
    const { el, reports } = await setup({ template: undefined });
    const shift = reports.reports.find((r) => r.period === 'shift')!;
    el.template = shift;
    await el.whenIdle();
    expect(rows(el)).toHaveLength(4); // 3 ca + tổng
    expect(norm(rows(el)[0]!.querySelector('th')?.textContent)).toBe('Ca 1 06:00–14:00');
    const month = reports.reports.find((r) => r.period === 'month')!;
    el.template = month;
    el.period = { m: '2026-10' };
    await el.whenIdle();
    expect(rows(el)).toHaveLength(32); // 31 ngày + tổng; ngày sau "bây giờ" là "chưa tới"
    expect(rows(el).some((r) => /chưa tới/.test(r.textContent ?? ''))).toBe(true);
  });

  it('mẫu theo ca lúc 01:07: mặc định ngày làm việc đang chạy (hôm trước, ca bắt đầu 06:00), không phải ngày lịch', async () => {
    // 2026-10-15 01:07 UTC+7: ngày làm việc 06:00 hôm 15 chưa bắt đầu; ngày đang chạy là 14 (06:00 14 → 06:00 15).
    const at0107 = Date.UTC(2026, 9, 14, 18, 7);
    const { el, reports } = await setup({
      template: undefined,
      period: undefined,
      now: () => at0107,
    });
    el.template = reports.reports.find((r) => r.period === 'shift')!;
    await el.whenIdle();
    const input = el.querySelector<HTMLInputElement>('[data-role="period"]')!;
    expect(input.value).toBe('2026-10-14');
    expect(rows(el)).toHaveLength(4); // 3 ca + tổng, ca 3 đang chạy
  });

  it('mẫu chưa có cột hoặc nhóm: hướng dẫn, không lỗi', async () => {
    const { el, reports } = await setup();
    const empty: ReportsConfig['reports'][number] = {
      ...structuredClone(reports.reports[0]!),
      columns: [],
    };
    el.template = empty;
    await el.whenIdle();
    expect(norm(el.querySelector('.rp-msg')?.textContent)).toContain('cột');
    expect(view(el).querySelector('table.rpt')).toBeNull();
    el.template = { ...empty, group: '' };
    await el.whenIdle();
    expect(el.querySelector('.rp-msg')).not.toBeNull();
  });

  it('nút xuất thử bốn định dạng gọi report-export và lưu qua lệnh Tauri giả: tên file, byte', async () => {
    const save = vi.fn(async () => 'saved' as const);
    const exporter = {
      csv: exportCsv,
      xlsx: exportXlsx,
      pdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    };
    const { el } = await setup({ save, exporter });
    for (const act of ['csv', 'csv-vi', 'xlsx', 'pdf']) {
      el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!.click();
      await el.whenIdle();
    }
    const calls = save.mock.calls as unknown as Array<[string, Uint8Array, string]>;
    expect(calls.map((c) => [c[0], c[2]])).toEqual([
      ['dien-ngay_2026-10-12.csv', 'csv'],
      ['dien-ngay_2026-10-12.csv', 'csv'],
      ['dien-ngay_2026-10-12.xlsx', 'xlsx'],
      ['dien-ngay_2026-10-12.pdf', 'pdf'],
    ]);
    expect([...calls[0]![1].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    expect(new TextDecoder().decode(calls[1]![1])).toContain(';'); // CSV Excel vi-VN dùng dấu chấm phẩy
    expect([...calls[2]![1].slice(0, 2)]).toEqual([0x50, 0x4b]); // zip
    expect([...calls[3]![1].slice(0, 4)]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('xuất thử XLSX/PDF truyền chủ đề của project (feature 012 T049)', async () => {
    const metas: Array<ExportMeta['theme']> = [];
    const exporter = {
      csv: exportCsv,
      xlsx: async (_t: ReportTable, m: ExportMeta) => {
        metas.push(m.theme);
        return new Uint8Array([1]);
      },
      pdf: async (_t: ReportTable, m: ExportMeta) => {
        metas.push(m.theme);
        return new Uint8Array([2]);
      },
    };
    const { el } = await setup({ exporter, theme: 'vivid' });
    for (const act of ['xlsx', 'pdf']) {
      el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!.click();
      await el.whenIdle();
    }
    el.theme = undefined;
    el.querySelector<HTMLButtonElement>('[data-act="pdf"]')!.click();
    await el.whenIdle();
    expect(metas).toEqual(['vivid', 'vivid', undefined]);
    // feature 029: chủ đề cũ của project bị bỏ qua
    expect([projectTheme({ theme: 'dark' }), projectTheme({}), projectTheme(null)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('thiết bị: 401 hiện nút Đăng nhập; BUSY và RANGE_TOO_LARGE hiện lời nhắn riêng; mất kết nối cho phép thử lại', async () => {
    const fake = new FakeHistorySource();
    fake.failWith = new HistoryError('AUTH_REQUIRED', 'AUTH_REQUIRED', 401);
    const login = vi.fn();
    fake.requestLogin = login;
    const { el } = await setup({ source: fake });
    expect(norm(el.querySelector('.rp-msg')?.textContent)).toContain('Đăng nhập');
    el.querySelector<HTMLButtonElement>('[data-act="login"]')!.click();
    expect(login).toHaveBeenCalledOnce();
    fake.failWith = new HistoryError('RANGE_TOO_LARGE', 'x', 422);
    el.refresh();
    await el.whenIdle();
    expect(norm(el.querySelector('.rp-msg')?.textContent)).toContain('thu hẹp');
    fake.failWith = new HistoryError('BUSY', 'x', 429);
    el.refresh();
    await el.whenIdle();
    expect(norm(el.querySelector('.rp-msg')?.textContent)).toContain('bận');
    fake.failWith = new HistoryError('NETWORK', 'x');
    el.refresh();
    await el.whenIdle();
    expect(el.querySelector('[data-act="retry"]')).not.toBeNull();
    fake.failWith = null;
    el.querySelector<HTMLButtonElement>('[data-act="retry"]')!.click();
    await el.whenIdle();
    expect(el.querySelector('.rp-msg[data-state="error"]')).toBeNull();
  });

  it('nhãn, tiêu đề và tên là văn bản thuần: không dựng HTML từ dữ liệu', async () => {
    const { el, reports } = await setup();
    const evil = structuredClone(reports.reports[0]!);
    evil.columns![0]!.label = '<img src=x onerror=alert(1)>';
    el.template = evil;
    await el.whenIdle();
    expect(el.querySelector('img')).toBeNull();
    expect(view(el).querySelector('img')).toBeNull();
    expect(heads(el)[1]).toContain('<img src=x onerror=alert(1)>');
  });

  it('chỉ đọc kiểu `ReportTemplate`: mẫu của project dùng được trực tiếp', async () => {
    const { reports } = await setup();
    const t: ReportTemplate = reports.reports[0] as unknown as ReportTemplate;
    expect(t.columns!.length).toBeGreaterThan(0);
  });
});
