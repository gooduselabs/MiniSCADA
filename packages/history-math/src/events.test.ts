// Feature 015 (specs/015-reports/spec.md US3–US5): báo cáo alarm, vận hành thiết bị (số lần bật), ghi PLC của logic
// dựng thành ReportTable mở rộng. Kết quả tính tay.
import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from './agg.ts';
import {
  alarmReport,
  countStarts,
  logicReport,
  type AlarmOccurrence,
  type LogicEvent,
} from './events.ts';
import { localMidnight, parseUtcOffset } from './format.ts';
import { buildReport, isoWeekOf, reportRequest, type ReportTemplate } from './report.ts';

const TZ = '+07:00';
const tz = parseUtcOffset(TZ);
const D0 = localMidnight(2026, 10, 19, tz);
const at = (h: number, m = 0) => D0 + h * HOUR_MS + m * MINUTE_MS;

const occ = (
  alarmId: string,
  priority: string,
  area: string | null,
  tsActive: number,
  tsAck: number | null,
  tsReturn: number | null,
  ackUser: string | null = tsAck ? 'ca1' : null,
): AlarmOccurrence => ({
  alarmId,
  name: alarmId.toUpperCase(),
  priority,
  area,
  text: `Nội dung ${alarmId}`,
  tsActive,
  tsAck,
  tsReturn,
  ackUser,
});

describe('isoWeekOf', () => {
  it('ngày → tuần ISO (cả ranh giới năm)', () => {
    expect(isoWeekOf(2026, 10, 19)).toBe('2026-W43');
    expect(isoWeekOf(2026, 10, 25)).toBe('2026-W43');
    expect(isoWeekOf(2025, 12, 29)).toBe('2026-W01');
    expect(isoWeekOf(2021, 1, 3)).toBe('2020-W53');
  });
});

describe('alarmReport', () => {
  const tpl: ReportTemplate = {
    id: 'alarm-ngay',
    name: 'Alarm ngày',
    kind: 'alarm',
    period: 'day',
  };
  const items = [
    occ('muc_cao', 'critical', 'bon', at(1, 10), at(1, 20), at(2, 0)),
    occ('muc_cao', 'critical', 'bon', at(5, 0), at(5, 30), null),
    occ('bom_loi', 'major', 'bom', at(1, 50), null, at(3, 0)),
    occ('ap_thap', 'minor', null, at(8, 0), at(8, 6), at(8, 30)),
    occ('muc_cao', 'critical', 'bon', at(23, 0), null, null),
  ];
  const t = alarmReport({
    template: tpl,
    select: { d: '2026-10-19' },
    tz: TZ,
    now: D0 + DAY_MS + 1,
    items,
  });

  it('bảng chính: số lần xuất hiện, xác nhận, hết theo giờ; dòng tổng', () => {
    expect(t.kind).toBe('alarm');
    expect(t.rows).toHaveLength(24);
    expect(t.columns.map((c) => c.label)).toEqual(['Xuất hiện', 'Xác nhận', 'Hết']);
    expect(t.columns.every((c) => c.plain)).toBe(true);
    expect(t.rows[1]!.cells).toEqual([2, 1, 0]);
    expect(t.rows[2]!.cells).toEqual([0, 0, 1]);
    expect(t.totals).toEqual([5, 3, 3]);
    expect(t.totalsText).toEqual(['5', '3', '3']);
    expect(t.showCoverage).toBe(false);
  });

  it('thẻ: tổng, chưa xác nhận, thời gian trung bình tới xác nhận (phút), đang còn', () => {
    expect(t.tiles!.map((x) => [x.label, x.text, x.unit])).toEqual([
      ['Số lần xuất hiện', '5', 'lần'],
      ['Chưa xác nhận', '2', 'lần'],
      ['TB tới xác nhận', '15,3', 'phút'],
      ['Đang còn', '2', 'lần'],
    ]);
  });

  it('thống kê theo mức (nặng trước), theo khu, top 10', () => {
    const [byPrio, byArea, top, list] = t.sections!;
    expect(byPrio!.title).toBe('Theo mức ưu tiên');
    expect(byPrio!.rows).toEqual([
      ['Khẩn cấp', '3', '1', '20,0'],
      ['Quan trọng', '1', '1', '–'],
      ['Nhỏ', '1', '0', '6,0'],
    ]);
    expect(byArea!.rows).toEqual([
      ['bon', '3', '1'],
      ['bom', '1', '1'],
      ['(không khu)', '1', '0'],
    ]);
    expect(top!.rows[0]).toEqual(['MUC_CAO', 'Nội dung muc_cao', 'Khẩn cấp', '3']);
    expect(top!.rows).toHaveLength(3);
    expect(list!.title).toBe('Danh sách sự kiện');
    expect(list!.rows).toHaveLength(11);
    expect(list!.rows[0]).toEqual([
      '19/10 01:10:00',
      'Xuất hiện',
      'MUC_CAO',
      'Khẩn cấp',
      'bon',
      'Nội dung muc_cao',
      '',
    ]);
    expect(list!.rows[1]![1]).toBe('Xác nhận');
    expect(list!.rows[1]![6]).toBe('ca1');
  });

  it('biểu đồ cột số lần xuất hiện theo hàng; hàng chưa tới là null', () => {
    const half = alarmReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: at(12),
      items,
    });
    expect(half.chart!.kind).toBe('bar');
    expect(half.chart!.series[0]!.values[1]).toBe(2);
    expect(half.chart!.series[0]!.values[13]).toBeNull();
    expect(half.rows[13]!.pending).toBe(true);
  });

  it('bị cắt ở giới hạn: ghi chú; không có lần nào: bảng 0', () => {
    const cut = alarmReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: at(30),
      items,
      truncated: true,
    });
    expect(cut.notes!.join(' ')).toMatch(/5\.000/);
    const none = alarmReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: at(30),
      items: [],
    });
    expect(none.totals).toEqual([0, 0, 0]);
    expect(none.tiles![2]!.text).toBe('–');
  });

  it('chữ của alarm đi nguyên văn (không HTML)', () => {
    const evil = occ('x', 'minor', '<b>', at(2), null, null);
    evil.text = '<img src=x onerror=alert(1)>';
    const r = alarmReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: at(30),
      items: [evil],
    });
    expect(r.sections![3]!.rows[0]![5]).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('countStarts (báo cáo thiết bị)', () => {
  const tpl: ReportTemplate = {
    id: 'bom',
    name: 'Bơm',
    kind: 'equipment',
    period: 'shift',
    shifts: { count: 3, start: '06:00' },
    columns: [{ tagId: 'RUN', label: 'Bơm 1', unit: 'giờ', functions: ['onTime', 'starts'] }],
  };
  const req = reportRequest(tpl, { d: '2026-10-19' }, tz);
  // hàng thô [seq, ts, RUN, FAN]
  const rows: Array<Array<number | boolean | null>> = [
    [1, at(6, 0), 1, 0], // đầu kỳ: trạng thái trước không biết, không đếm
    [2, at(7, 0), 0, 0],
    [3, at(8, 0), 1, 1],
    [4, at(9, 0), null, 0],
    [5, at(10, 0), 0, 1],
    [6, at(15, 0), true, 0],
    [7, at(23, 0), false, 1],
    [8, at(26, 0), 1, 1],
  ];

  it('cạnh lên mỗi hàng, giá trị null bỏ qua, true/số đều được', () => {
    const s = countStarts(rows, ['RUN', 'FAN'], req, true);
    expect(s.RUN).toEqual([1, 1, 1]);
    expect(s.FAN).toEqual([2, 0, 1]);
  });

  it('chưa đọc hết dòng thô: mọi ô null (không bịa)', () => {
    const s = countStarts(rows, ['RUN'], req, false);
    expect(s.RUN).toEqual([null, null, null]);
  });

  it('buildReport dùng số lần bật: dòng tổng là tổng các hàng', () => {
    const t = buildReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: at(40),
      aggregates: [],
      starts: countStarts(rows, ['RUN'], req, true),
    });
    expect(t.columns.map((c) => c.fn)).toEqual(['onTime', 'starts']);
    expect(t.rows.map((r) => r.cells[1])).toEqual([1, 1, 1]);
    expect(t.totals![1]).toBe(3);
    expect(t.rows[0]!.text[1]).toBe('1');
  });
});

describe('logicReport', () => {
  const tpl: ReportTemplate = { id: 'logic', name: 'Logic', kind: 'logic', period: 'day' };
  const ev = (
    id: number,
    ts: number,
    rule: string,
    action: string,
    result: string,
    value?: unknown,
  ): LogicEvent => ({
    id,
    ts,
    rule,
    action,
    tag: 'PUMP1.CMD',
    result,
    code: null,
    detail: value === undefined ? null : JSON.stringify({ value }),
  });
  const events = [
    ev(1, at(1), 'bom_tat', 'logic.write', 'ok', false),
    ev(2, at(1, 30), 'bom_bat', 'logic.write', 'ok', true),
    ev(3, at(2), 'bom_bat', 'logic.write', 'failed', true),
    ev(4, at(2, 10), 'bom_bat', 'logic.write.suppressed', 'denied'),
    ev(5, at(4), 'bom_tat', 'logic.throttled', 'denied'),
  ];
  const t = logicReport({
    template: tpl,
    select: { d: '2026-10-19' },
    tz: TZ,
    now: at(30),
    events,
  });

  it('bảng chính: thành công, lỗi, bị chặn theo giờ', () => {
    expect(t.columns.map((c) => c.label)).toEqual(['Thành công', 'Lỗi', 'Bị chặn']);
    expect(t.rows[1]!.cells).toEqual([2, 0, 0]);
    expect(t.rows[2]!.cells).toEqual([0, 1, 1]);
    expect(t.totals).toEqual([2, 1, 2]);
  });

  it('thẻ, theo luật, danh sách (giá trị từ detail)', () => {
    expect(t.tiles!.map((x) => x.text)).toEqual(['5', '2', '1', '2']);
    const [byRule, list] = t.sections!;
    expect(byRule!.rows).toEqual([
      ['bom_bat', '3', '1', '1', '1', '19/10 02:10:00'],
      ['bom_tat', '2', '1', '0', '1', '19/10 04:00:00'],
    ]);
    expect(list!.rows[0]).toEqual([
      '19/10 01:00:00',
      'bom_tat',
      'PUMP1.CMD',
      'false',
      'Thành công',
    ]);
    expect(list!.rows[3]![4]).toBe('Bị chặn');
    expect(list!.rows[3]![3]).toBe('');
  });
});
