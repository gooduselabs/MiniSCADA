// <mat-report-view> (feature 015, T020): thẻ, khung biểu đồ, bảng sọc với hàng tổng, bảng phụ, ghi chú, chữ thuần.
import { alarmReport, buildReport, parseUtcOffset, localMidnight } from '@mat/history-math';
import { afterEach, describe, expect, it } from 'vitest';
import { setEChartsLoader } from '../chart/echarts-lite.ts';
import { fakeECharts } from '../widgets/test-util.ts';
import './report-view.ts';
import type { MatReportView } from './report-view.ts';

const TZ = '+07:00';
const D0 = localMidnight(2026, 10, 19, parseUtcOffset(TZ));
const HOUR = 3_600_000;

function table() {
  const count = 24;
  const arr = (f: (k: number) => number) => Array.from({ length: count }, (_, k) => f(k));
  return buildReport({
    template: {
      id: 'd',
      name: 'Điện ngày',
      title: 'BÁO CÁO <b>ĐIỆN</b>',
      period: 'day',
      columns: [
        { tagId: 'E', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: ['delta', 'max'] },
      ],
    },
    select: { d: '2026-10-19' },
    tz: TZ,
    now: D0 + 12 * HOUR,
    org: 'Nhà máy A',
    aggregates: [
      {
        start: D0,
        count,
        bucketMs: HOUR,
        series: [
          {
            tagId: 'E',
            n: arr(() => 5),
            min: arr((k) => k * 10),
            max: arr((k) => k * 10 + 10),
            first: arr((k) => k * 10),
            last: arr((k) => k * 10 + 10),
            sumw: arr((k) => (k * 10 + 5) * HOUR),
            wms: arr((k) => (k === 3 ? HOUR / 2 : HOUR)),
          },
        ],
      },
    ],
  });
}

async function mount(t: ReturnType<typeof table>): Promise<MatReportView> {
  const el = document.createElement('mat-report-view');
  el.table = t;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  setEChartsLoader(null);
});

describe('<mat-report-view>', () => {
  it('dải tiêu đề, thẻ màu đặc theo bảng --mat-tile-*, chữ thuần', async () => {
    fakeECharts();
    const el = await mount(table());
    const r = el.shadowRoot!;
    expect(r.querySelector('.org')!.textContent).toBe('Nhà máy A');
    expect(r.querySelector('.title')!.textContent).toBe('BÁO CÁO <b>ĐIỆN</b>');
    expect(r.querySelector('.title b')).toBeNull();
    const tiles = [...r.querySelectorAll('.tile')];
    expect(tiles).toHaveLength(3);
    expect(tiles[0]!.getAttribute('style')).toContain('--mat-tile-teal');
    expect(tiles[0]!.getAttribute('aria-label')).toBe('Điện năng · chênh lệch: 120,0 kWh');
    expect(tiles[2]!.querySelector('.unit')!.textContent).toBe('%');
  });

  it('bảng: tiêu đề cột có hàm, hàng chưa tới, ô thiếu dữ liệu, hàng tổng nổi bật', async () => {
    fakeECharts();
    const el = await mount(table());
    const r = el.shadowRoot!;
    const heads = [...r.querySelectorAll('table.rpt thead th')].map((h) => h.textContent!.trim());
    expect(heads).toEqual([
      'Thời gian',
      'Điện năng (kWh) · chênh lệch',
      'Điện năng (kWh) · lớn nhất',
    ]);
    const rows = r.querySelectorAll('table.rpt tbody tr');
    expect(rows).toHaveLength(25);
    expect(rows[3]!.querySelector('td.miss')).not.toBeNull();
    expect(rows[13]!.querySelector('td.pending')!.getAttribute('colspan')).toBe('2');
    expect(r.querySelector('tr.total th')!.textContent).toBe('Tổng');
    expect(r.querySelector('.coverage')!.textContent).toContain('Dữ liệu đủ');
  });

  it('khung biểu đồ có tiêu đề; ECharts nhận cột bo góc, tooltip trục, chỉ chuỗi thuần', async () => {
    const fake = fakeECharts();
    const el = await mount(table());
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(el.shadowRoot!.querySelector('.chart .head')!.textContent).toBe('Điện năng (kWh)');
    const o = fake.option() as {
      series: Array<{ type: string; itemStyle: { borderRadius: number[] } }>;
    };
    expect(o.series[0]!.type).toBe('bar');
    expect(o.series[0]!.itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
  });

  it('báo cáo alarm: không có độ đủ dữ liệu, các bảng phụ, nội dung không thành HTML', async () => {
    fakeECharts();
    const t = alarmReport({
      template: { id: 'a', name: 'Alarm', kind: 'alarm', period: 'day' },
      select: { d: '2026-10-19' },
      tz: TZ,
      now: D0 + 30 * HOUR,
      items: [
        {
          alarmId: 'x',
          name: 'X',
          priority: 'critical',
          area: null,
          text: '<img src=x onerror=alert(1)>',
          tsActive: D0 + HOUR,
          tsAck: null,
          tsReturn: null,
        },
      ],
    });
    const el = await mount(t);
    const r = el.shadowRoot!;
    expect(r.querySelector('.coverage')).toBeNull();
    expect(r.querySelectorAll('figure.section')).toHaveLength(4);
    expect(r.querySelector('img')).toBeNull();
    expect(r.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('không có bảng: không vẽ gì', async () => {
    const el = document.createElement('mat-report-view');
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('article')).toBeNull();
  });
});

describe('<mat-report-view> chọn phần (trình thiết kế)', () => {
  it('selectable: bấm tiêu đề cột phát report-select col:<tag>, phần đang chọn có lớp sel', async () => {
    fakeECharts();
    const el = await mount(table());
    el.selectable = true;
    el.selected = 'tiles';
    await el.updateComplete;
    const got: string[] = [];
    el.addEventListener('report-select', (e) => got.push((e as CustomEvent).detail.part));
    const r = el.shadowRoot!;
    (r.querySelector('table.rpt thead th.num') as HTMLElement).click();
    (r.querySelector('.band') as HTMLElement).click();
    expect(got).toEqual(['col:E.delta', 'general']);
    expect(r.querySelector('.tiles')!.classList.contains('sel')).toBe(true);
  });

  it('không selectable: không phát sự kiện', async () => {
    fakeECharts();
    const el = await mount(table());
    let n = 0;
    el.addEventListener('report-select', () => n++);
    (el.shadowRoot!.querySelector('.band') as HTMLElement).click();
    expect(n).toBe(0);
  });
});
