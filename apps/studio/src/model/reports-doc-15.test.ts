// Feature 015 (T030): mô hình của trình thiết kế báo cáo: loại mẫu, thẻ, biểu đồ, tên đơn vị, hàm theo loại và kiểu Tag,
// thêm cột theo loại, mẫu có sẵn, sự kiện mô phỏng cho xem trước alarm/logic.
import type { LoggingConfig, ReportsConfig, TagDataType } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  addColumns,
  addReport,
  addTemplate,
  fnApplicable,
  fnsFor,
  setChart,
  setKind,
  setOrg,
  setPeriod,
  setTiles,
  suggestUnit,
  toggleFunction,
} from './reports-doc.ts';
import {
  REPORT_PRESETS,
  presetBlocked,
  presetTemplate,
  type PresetContext,
} from './report-presets.ts';
import { simReportEvents } from './sim-report-events.ts';

const LOG: LoggingConfig = {
  schemaVersion: '1.1.0',
  timeZone: '+07:00',
  groups: [
    {
      id: 'dien',
      name: 'Điện',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      aggregates: {},
      tags: [{ tagId: 'KWH' }, { tagId: 'KW' }, { tagId: 'BOM1.RUN' }, { tagId: 'QUAT.RUN' }],
    },
  ],
} as unknown as LoggingConfig;
const TYPES = new Map<string, TagDataType>([
  ['KWH', 'FLOAT64'],
  ['KW', 'FLOAT32'],
  ['BOM1.RUN', 'BOOL'],
  ['QUAT.RUN', 'BOOL'],
]);
const INFO: Record<string, { unit?: string; description?: string }> = {
  KWH: { unit: 'kWh', description: 'Điện năng' },
  KW: { unit: 'kW', description: 'Công suất' },
  'BOM1.RUN': { description: 'Bơm 1 chạy' },
};
const ctx = (format11 = true): PresetContext => ({
  logging: LOG,
  types: TYPES,
  info: (id) => INFO[id],
  format11,
});

const one = (): ReportsConfig => addReport(null, LOG, '1.1.0');

describe('reports-doc (015)', () => {
  it('reports.json mới mang phiên bản của project', () => {
    expect(one().schemaVersion).toBe('1.1.0');
    expect(addReport(null, LOG).schemaVersion).toBe('0.6.0');
  });

  it('hàm theo loại: bảng có onTime (chỉ BOOL), thiết bị chỉ onTime/starts, alarm không có hàm', () => {
    expect(fnsFor('table')).toContain('onTime');
    expect(fnsFor('table')).not.toContain('starts');
    expect(fnsFor('equipment')).toEqual(['onTime', 'starts']);
    expect(fnsFor('alarm')).toEqual([]);
    expect(fnApplicable('BOOL', 'onTime')).toBe(true);
    expect(fnApplicable('FLOAT32', 'onTime')).toBe(false);
    expect(fnApplicable('BOOL', 'starts', 'equipment')).toBe(true);
    expect(fnApplicable('BOOL', 'avg', 'equipment')).toBe(false);
    expect(fnApplicable('BOOL', 'starts')).toBe(false);
    expect(suggestUnit('onTime', undefined)).toBe('giờ');
    expect(suggestUnit('starts', undefined)).toBe('lần');
  });

  it('thêm cột: BOOL ở 1.1 là thời gian ON (giờ); thiết bị chỉ nhận BOOL; alarm không có cột', () => {
    const r = addColumns(one(), 0, ['KW', 'BOM1.RUN'], LOG, TYPES, true);
    expect(r.cfg.reports[0]!.columns).toEqual([
      { tagId: 'KW', functions: ['avg'] },
      { tagId: 'BOM1.RUN', unit: 'giờ', decimals: 2, functions: ['onTime'] },
    ]);
    const eq = setKind(one(), 0, 'equipment', LOG, TYPES);
    const r2 = addColumns(eq, 0, ['KW', 'BOM1.RUN'], LOG, TYPES, true);
    expect(r2.rejected).toEqual([{ tagId: 'KW', reason: 'notBool' }]);
    expect(r2.cfg.reports[0]!.columns![0]!.functions).toEqual(['onTime', 'starts']);
    const al = setKind(one(), 0, 'alarm', LOG, TYPES);
    expect(addColumns(al, 0, ['KW'], LOG, TYPES, true).rejected[0]!.reason).toBe('noColumns');
  });

  it('đổi loại: alarm bỏ nhóm và cột; thiết bị giữ cột BOOL; về bảng bỏ starts', () => {
    const base = addColumns(one(), 0, ['KW', 'BOM1.RUN'], LOG, TYPES, true).cfg;
    const al = setKind(base, 0, 'alarm', LOG, TYPES).reports[0]!;
    expect(al.kind).toBe('alarm');
    expect(al.group).toBeUndefined();
    expect(al.columns).toBeUndefined();
    const eq = setKind(base, 0, 'equipment', LOG, TYPES);
    expect(eq.reports[0]!.columns!.map((c) => c.tagId)).toEqual(['BOM1.RUN']);
    const back = setKind(eq, 0, 'table', LOG, TYPES).reports[0]!;
    expect(back.kind).toBeUndefined();
    expect(back.columns![0]!.functions).toEqual(['onTime']);
    // từ alarm về bảng: nhóm mặc định, cột rỗng
    const t2 = setKind(setKind(base, 0, 'alarm', LOG, TYPES), 0, 'table', LOG, TYPES).reports[0]!;
    expect(t2.group).toBe('dien');
    expect(t2.columns).toEqual([]);
  });

  it('thẻ, biểu đồ, kỳ tuần/khoảng, tên đơn vị: giá trị mặc định thì bỏ khóa', () => {
    let c = setTiles(one(), 0, false);
    expect(c.reports[0]!.tiles).toBe(false);
    c = setTiles(c, 0, true);
    expect('tiles' in c.reports[0]!).toBe(false);
    c = setChart(c, 0, 'bar');
    expect(c.reports[0]!.chart).toBe('bar');
    expect('chart' in setChart(c, 0, 'auto').reports[0]!).toBe(false);
    c = setPeriod(c, 0, 'week');
    expect(c.reports[0]!.rowMinutes).toBeUndefined();
    c = setOrg(c, '  Nhà máy  ');
    expect(c.org).toBe('Nhà máy');
    expect('org' in setOrg(c, '')).toBe(false);
  });

  it('bật/tắt hàm giữ thứ tự chuẩn, cả starts ở mẫu thiết bị', () => {
    const eq = addColumns(
      setKind(one(), 0, 'equipment', LOG, TYPES),
      0,
      ['BOM1.RUN'],
      LOG,
      TYPES,
      true,
    ).cfg;
    const off = toggleFunction(eq, 0, 0, 'onTime');
    expect(off.reports[0]!.columns![0]!.functions).toEqual(['starts']);
    expect(toggleFunction(off, 0, 0, 'onTime').reports[0]!.columns![0]!.functions).toEqual([
      'onTime',
      'starts',
    ]);
  });
});

describe('mẫu có sẵn (015)', () => {
  it('8 mẫu (029 thêm điện năng tháng); mẫu 1.1 bị khóa ở project cũ', () => {
    expect(REPORT_PRESETS.map((p) => p.id)).toEqual([
      'shift',
      'day',
      'month',
      'energy',
      'energyMonth',
      'alarm',
      'equipment',
      'logic',
    ]);
    const alarm = REPORT_PRESETS.find((p) => p.id === 'alarm')!;
    expect(presetBlocked(alarm, ctx(false))).toMatch(/1\.1/);
    expect(presetBlocked(alarm, ctx(true))).toBeNull();
    expect(presetTemplate('alarm', ctx(false))).toBeNull();
  });

  it('năng lượng: kWh chênh lệch, kW trung bình và lớn nhất; nhãn và đơn vị từ Tag', () => {
    const t = presetTemplate('energy', ctx())!;
    expect(t.group).toBe('dien');
    expect(t.columns).toEqual([
      { tagId: 'KWH', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: ['delta'] },
      { tagId: 'KW', label: 'Công suất', unit: 'kW', decimals: 1, functions: ['avg', 'max'] },
    ]);
    expect(t.chart).toBe('bar');
  });

  it('điện năng tháng (029): kỳ tháng, hiệu số kWh, tổng, biểu đồ cột', () => {
    const t = presetTemplate('energyMonth', ctx())!;
    expect(t.id).toBe('dien-nang-thang');
    expect(t.period).toBe('month');
    expect(t.rowMinutes).toBeUndefined();
    expect(t.totals).toBe(true);
    expect(t.chart).toBe('bar');
    expect(t.columns![0]!.functions).toEqual(['delta']);
  });

  it('thiết bị: Tag BOOL, ca, giờ chạy và số lần bật; ca/ngày/tháng có kỳ đúng', () => {
    const t = presetTemplate('equipment', ctx())!;
    expect(t.kind).toBe('equipment');
    expect(t.columns!.map((c) => c.tagId)).toEqual(['BOM1.RUN', 'QUAT.RUN']);
    expect(t.columns![0]!.functions).toEqual(['onTime', 'starts']);
    expect(presetTemplate('shift', ctx())!.shifts).toEqual({ count: 3, start: '06:00' });
    expect(presetTemplate('day', ctx())!.rowMinutes).toBe(60);
    expect(presetTemplate('month', ctx())!.period).toBe('month');
    expect(presetTemplate('logic', ctx())).toMatchObject({ kind: 'logic', period: 'day' });
  });

  it('addTemplate: id không trùng, tên giữ nguyên', () => {
    const t = presetTemplate('day', ctx())!;
    const c1 = addTemplate(null, '1.1.0', t);
    const c2 = addTemplate(c1, '1.1.0', t);
    expect(c2.reports.map((r) => r.id)).toEqual(['bao-cao-ngay', 'bao-cao-ngay-2']);
    expect(c2.reports[1]!.name).toBe('Báo cáo ngày');
  });
});

describe('sự kiện mô phỏng (015)', () => {
  const D0 = Date.UTC(2026, 9, 19, 17);
  const src = simReportEvents({
    alarms: {
      schemaVersion: '1.1.0',
      alarms: [
        {
          id: 'muc',
          name: 'Mức cao',
          type: 'digital',
          tag: 'X',
          trigger: true,
          class: 'kc',
          area: 'bon',
        },
      ],
    } as never,
    alarmClasses: {
      schemaVersion: '1.1.0',
      classes: [{ id: 'kc', name: 'Khẩn', priority: 'critical', color: 'red' }],
    } as never,
    logic: {
      schemaVersion: '1.1.0',
      rules: [{ id: 'r1', when: 'X', onRise: [{ do: 'write', tag: 'PUMP' }] }],
    },
  });
  const sig = new AbortController().signal;

  it('tất định, trong kỳ, tên và mức lấy từ project', async () => {
    const a = await src.alarms(D0, D0 + 86_400_000, 5000, sig);
    const b = await src.alarms(D0, D0 + 86_400_000, 5000, sig);
    expect(a).toEqual(b);
    expect(a.items.length).toBeGreaterThan(5);
    expect(a.items.every((x) => x.tsActive >= D0 && x.tsActive < D0 + 86_400_000)).toBe(true);
    expect(a.items[0]).toMatchObject({
      alarmId: 'muc',
      name: 'Mức cao',
      priority: 'critical',
      area: 'bon',
    });
  });

  it('logic: lệnh ghi của luật; không có luật thì enabled false', async () => {
    const l = await src.logic(D0, D0 + 86_400_000, 5000, sig);
    expect(l.enabled).toBe(true);
    expect(l.events.length).toBeGreaterThan(3);
    expect(l.events[0]).toMatchObject({ rule: 'r1', tag: 'PUMP' });
    const none = simReportEvents({ alarms: null, alarmClasses: null, logic: null });
    expect((await none.logic(D0, D0 + 1000, 10, sig)).enabled).toBe(false);
  });
});
