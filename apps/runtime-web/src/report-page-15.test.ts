// Feature 015 (T024): trang báo cáo với kỳ tuần, khoảng; mẫu thiết bị (số lần bật từ dòng thô), alarm, logic; tên đơn vị;
// <mat-report-view> dựng thẻ và bảng phụ; lỗi quyền và runtime chưa hỗ trợ.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHistorySource, type AggregateQuery, type AggregateResult } from '@mat/ui-components';
import { ReportPage, type ReportsFile } from './report-page.ts';
import { EventSourceError, type EventSources } from './report-sources.ts';

const NOW = Date.UTC(2026, 9, 21, 8, 30, 0); // 15:30 +07:00 thứ Tư 2026-10-21
const TZ = '+07:00';
const D20 = Date.UTC(2026, 9, 19, 17, 0, 0); // 00:00 +07:00 ngày 2026-10-20

const FILE: ReportsFile = {
  org: 'Nhà máy nước <b>A</b>',
  reports: [
    {
      id: 'dien-tuan',
      name: 'Điện tuần',
      group: 'dien',
      period: 'week',
      columns: [
        { tagId: 'KWH', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: ['delta'] },
      ],
    },
    {
      id: 'bom',
      name: 'Vận hành bơm',
      kind: 'equipment',
      group: 'dien',
      period: 'day',
      rowMinutes: 60,
      columns: [{ tagId: 'RUN', label: 'Bơm 1', unit: 'giờ', functions: ['onTime', 'starts'] }],
    },
    { id: 'alarm-ngay', name: 'Alarm ngày', kind: 'alarm', period: 'day' },
    { id: 'logic-khoang', name: 'Logic', kind: 'logic', period: 'range' },
  ],
};

function agg(q: AggregateQuery): AggregateResult {
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
      min: col(() => 0),
      max: col(() => 1),
      first: col((k) => k),
      last: col((k) => k + 1),
      sumw: col(() => q.bucketMs / 2),
      wms: col(() => q.bucketMs),
      avg: col(() => 0.5),
      sum: col(() => 0),
    })),
  };
}

function setup(events?: EventSources) {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.id = 'dien';
  hist.catalogData.groups[0]!.timeZone = TZ;
  hist.aggregateFn = agg;
  const root = document.createElement('div');
  document.body.append(root);
  const urls: string[] = [];
  const page = new ReportPage({
    container: root,
    history: hist,
    now: () => NOW,
    loadReports: async () => FILE,
    userName: () => 'xem1',
    onUrl: (h) => urls.push(h),
    download: () => {},
    projectName: () => 'Dự án',
    ...(events ? { events } : {}),
  });
  return { root, hist, page, urls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}
const view = (root: HTMLElement) => root.querySelector('mat-report-view')!.shadowRoot!;
const click = (root: HTMLElement, sel: string) =>
  root.querySelector<HTMLButtonElement>(sel)!.click();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('trang báo cáo (015)', () => {
  it('kỳ tuần: ô tuần mặc định là tuần đang chạy, 7 hàng, đường dẫn ?w=, tên đơn vị chữ thuần', async () => {
    const { root, page, urls } = setup();
    await page.show('dien-tuan', new URLSearchParams());
    await flush();
    const input = root.querySelector<HTMLInputElement>('input[type="week"]')!;
    expect(input.value).toBe('2026-W43');
    click(root, 'button.view');
    await flush();
    expect(urls.at(-1)).toBe('#/report/dien-tuan?w=2026-W43');
    const v = view(root);
    expect(v.querySelectorAll('table.rpt tbody tr')).toHaveLength(8);
    expect(v.querySelector('.org')!.textContent).toBe('Nhà máy nước <b>A</b>');
    expect(v.querySelectorAll('.tile').length).toBeGreaterThan(0);
  });

  it('thiết bị: giờ chạy từ aggregate, số lần bật từ dòng thô (đọc theo trang tới hết)', async () => {
    const { root, hist, page } = setup();
    let call = 0;
    hist.rowsFn = (q) => {
      call++;
      const t = q.from;
      const rows =
        call === 1
          ? [
              [1, t + 1000, 0],
              [2, t + 2000, 1],
            ]
          : [
              [3, t + 3600_000 + 5, 0],
              [4, t + 3600_000 + 9, 1],
            ];
      return {
        group: 'dien',
        timeZone: TZ,
        order: 'asc',
        columns: [{ tagId: 'RUN' }],
        rows,
        next: call === 1 ? 2 : null,
      };
    };
    await page.show('bom', new URLSearchParams('d=2026-10-20'));
    await flush();
    expect(hist.rowsCalls).toHaveLength(2);
    expect(hist.rowsCalls[1]!.after).toBe(2);
    const rows = [...view(root).querySelectorAll('table.rpt tbody tr')];
    const cells = (i: number) =>
      [...rows[i]!.querySelectorAll('td')].map((c) => c.textContent!.trim());
    expect(cells(0)).toEqual(['0,50', '1']);
    expect(cells(1)).toEqual(['0,50', '1']);
    expect(cells(24)).toEqual(['12,00', '2']);
  });

  it('alarm: đọc nguồn alarm trong kỳ, thẻ và bảng phụ; không cần nhóm lưu trữ', async () => {
    const calls: Array<[number, number]> = [];
    const { root, page } = setup({
      alarms: async (from, to) => {
        calls.push([from, to]);
        return {
          items: [
            {
              alarmId: 'muc',
              name: 'Mức cao',
              priority: 'critical',
              area: 'bon',
              text: 'Bồn đầy',
              tsActive: D20 + 3600_000,
              tsAck: null,
              tsReturn: null,
            },
          ],
          truncated: false,
        };
      },
      logic: async () => ({ events: [], truncated: false, enabled: true }),
    });
    await page.show('alarm-ngay', new URLSearchParams('d=2026-10-20'));
    await flush();
    expect(calls[0]).toEqual([D20, D20 + 86_400_000]);
    const v = view(root);
    expect(v.querySelectorAll('figure.section')).toHaveLength(4);
    expect(v.querySelector('.tile .value')!.textContent).toBe('1');
    expect(root.querySelector<HTMLButtonElement>('button.pdf')!.disabled).toBe(false);
  });

  it('alarm bị từ chối quyền: báo cần quyền trang Alarm', async () => {
    const { root, page } = setup({
      alarms: async () => {
        throw new EventSourceError('ACCESS_DENIED');
      },
      logic: async () => ({ events: [], truncated: false, enabled: true }),
    });
    await page.show('alarm-ngay', new URLSearchParams('d=2026-10-20'));
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('quyền xem alarm');
  });

  it('logic: khoảng ngày ?from=&to=, runtime cũ báo chưa hỗ trợ', async () => {
    const { root, page } = setup({
      alarms: async () => ({ items: [], truncated: false }),
      logic: async () => {
        throw new EventSourceError('NOT_SUPPORTED');
      },
    });
    await page.show('logic-khoang', new URLSearchParams('from=2026-10-01&to=2026-10-07'));
    await flush();
    expect(root.querySelector<HTMLInputElement>('#rpt-from')!.value).toBe('2026-10-01');
    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      'chưa hỗ trợ báo cáo logic',
    );
  });

  it('khoảng quá 31 ngày: không gửi, báo kỳ không hợp lệ', async () => {
    const logic = vi.fn(async () => ({ events: [], truncated: false, enabled: true }));
    const { root, page } = setup({ alarms: async () => ({ items: [], truncated: false }), logic });
    await page.show('logic-khoang', new URLSearchParams());
    await flush();
    const from = root.querySelector<HTMLInputElement>('#rpt-from')!;
    from.value = '2026-08-01';
    from.dispatchEvent(new Event('change'));
    click(root, 'button.view');
    await flush();
    expect(logic).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Kỳ không hợp lệ');
  });
});
