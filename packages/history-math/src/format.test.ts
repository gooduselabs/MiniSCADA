// T075: giờ địa phương theo múi của nhóm (không theo múi trình duyệt), số vi-VN, nhãn trục, chọn nguồn, con trỏ.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  chooseSource,
  formatLocal,
  formatNumber,
  nearestPoint,
  parseUtcOffset,
} from './format.ts';

const U = Date.UTC;

describe('parseUtcOffset', () => {
  it('±HH:MM -> mili giây', () => {
    expect(parseUtcOffset('+07:00')).toBe(7 * 3600000);
    expect(parseUtcOffset('+05:30')).toBe(5.5 * 3600000);
    expect(parseUtcOffset('-03:30')).toBe(-3.5 * 3600000);
    expect(parseUtcOffset('+00:00')).toBe(0);
  });
  it('từ chối chuỗi sai', () => {
    for (const s of ['7:00', '+7', '+25:00', 'UTC', '+07:60', ''])
      expect(() => parseUtcOffset(s), s).toThrow();
  });
});

describe('formatLocal', () => {
  it('+07:00, mili giây', () => {
    expect(formatLocal(U(2026, 9, 13, 3, 30, 45, 678), '+07:00', 'ms')).toBe(
      '2026-10-13 10:30:45.678',
    );
  });
  it('+05:30 và âm', () => {
    expect(formatLocal(U(2026, 9, 13, 3, 30), '+05:30', 'min')).toBe('2026-10-13 09:00');
    expect(formatLocal(U(2026, 9, 13, 3, 0), '-03:30', 'min')).toBe('2026-10-12 23:30');
  });
  it('sang ngày mới, năm mới, 29/02', () => {
    expect(formatLocal(U(2026, 11, 31, 18, 0), '+07:00', 'sec')).toBe('2027-01-01 01:00:00');
    expect(formatLocal(U(2028, 1, 28, 17, 30), '+07:00', 'min')).toBe('2028-02-29 00:30');
    expect(formatLocal(U(2027, 1, 28, 17, 30), '+07:00', 'min')).toBe('2027-03-01 00:30');
  });
  it('kiểu ngắn', () => {
    const t = U(2026, 9, 13, 3, 30, 45, 678);
    expect(formatLocal(t, '+07:00', 'date')).toBe('13/10/2026');
    expect(formatLocal(t, '+07:00', 'time')).toBe('10:30:45');
    expect(formatLocal(t, '+07:00', 'hm')).toBe('10:30');
    expect(formatLocal(t, '+07:00', 'dm')).toBe('13/10');
    expect(formatLocal(U(1969, 11, 31, 23, 59, 59, 999), '+00:00', 'ms')).toBe(
      '1969-12-31 23:59:59.999',
    );
  });
  it('nhận độ lệch dạng số (ms)', () => {
    expect(formatLocal(0, 7 * 3600000, 'ms')).toBe('1970-01-01 07:00:00.000');
  });
});

describe('formatNumber (vi-VN)', () => {
  it('nghìn chấm, thập phân phẩy', () => {
    expect(formatNumber(1277.7, 1)).toBe('1.277,7');
    expect(formatNumber(1234567.891, 2)).toBe('1.234.567,89');
    expect(formatNumber(5, 0)).toBe('5');
    expect(formatNumber(1000, 0)).toBe('1.000');
    expect(formatNumber(0.5, 3)).toBe('0,500');
  });
  it('âm, làm tròn nửa ra xa số 0, -0', () => {
    expect(formatNumber(-1234.5, 0)).toBe('-1.235');
    expect(formatNumber(-0.04, 1)).toBe('0,0');
    expect(formatNumber(1.005, 2)).toBe('1,01');
    expect(formatNumber(0.125, 2)).toBe('0,13');
  });
  it('null và không hữu hạn là chuỗi rỗng', () => {
    expect(formatNumber(null, 2)).toBe('');
    expect(formatNumber(Number.NaN, 2)).toBe('');
    expect(formatNumber(Infinity, 2)).toBe('');
  });
});

describe('axisTicks', () => {
  it('một giờ, tối đa 7 nhãn: bước 10 phút, nhãn HH:mm theo múi nhóm', () => {
    const from = U(2026, 9, 13, 3, 0);
    const t = axisTicks(from, from + 3600000, '+07:00', 7);
    expect(t.map((x) => x.label)).toEqual(['10:00', '10:10', '10:20', '10:30', '10:40', '10:50']);
    expect(t[0]!.t).toBe(from);
  });
  it('bảy ngày: bước một ngày, nhãn dd/MM ở nửa đêm địa phương', () => {
    const from = U(2026, 9, 6, 3, 30);
    const t = axisTicks(from, from + 7 * 86400000, '+07:00', 8);
    expect(t.map((x) => x.label)).toEqual([
      '07/10',
      '08/10',
      '09/10',
      '10/10',
      '11/10',
      '12/10',
      '13/10',
    ]);
    for (const x of t) expect((x.t + 7 * 3600000) % 86400000).toBe(0);
  });
  it('múi +05:30: bước 30 phút rơi đúng biên địa phương', () => {
    const from = U(2026, 9, 13, 3, 10);
    const t = axisTicks(from, from + 2 * 3600000, '+05:30', 6);
    expect(t[0]!.label).toBe('09:00'); // 03:30Z = 09:00 IST
    for (const x of t) expect(((x.t + 5.5 * 3600000) / 60000) % 30).toBe(0);
  });
  it('không bao giờ vượt maxTicks; khoảng rỗng không có nhãn', () => {
    for (const span of [1000, 59000, 3600000, 86400000 * 3, 86400000 * 400])
      expect(
        axisTicks(U(2026, 0, 1), U(2026, 0, 1) + span, '+07:00', 6).length,
      ).toBeLessThanOrEqual(6);
    expect(axisTicks(5, 5, '+07:00', 6)).toEqual([]);
  });
});

describe('chooseSource (history-api.md §3.1)', () => {
  const H = 3600000;
  const base = {
    maxPoints: 1000,
    res: 'auto' as const,
    reduce: 'minmax' as const,
    rowBytes: 100,
    scanLimitBytes: 64 * 1024 * 1024,
    aggregates: {
      minute: { from: 0, to: 40 * 86400000 },
      hour: { from: 0, to: 40 * 86400000 },
    },
  };
  it('cửa sổ giảm >= 1 giờ và bảng giờ phủ: chọn 1h', () => {
    const r = chooseSource({ ...base, from: 0, to: 30 * 86400000, rowsInRange: 1e9 });
    expect(r).toEqual({ ok: true, res: '1h', reduce: 'merge', approximate: false });
  });
  it('cửa sổ 1 phút tới dưới 1 giờ: 1m', () => {
    const r = chooseSource({ ...base, from: 0, to: 5 * 86400000, rowsInRange: 1e9 });
    expect(r).toMatchObject({ ok: true, res: '1m', reduce: 'merge' });
  });
  it('khoảng ngắn: thô với reduce theo tham số', () => {
    const r = chooseSource({ ...base, from: 0, to: H, rowsInRange: 3600 });
    expect(r).toEqual({ ok: true, res: 'raw', reduce: 'minmax', approximate: false });
  });
  it('bảng tổng hợp phủ dưới 50 %: không dùng, rơi về thô nếu không quá giới hạn', () => {
    const aggregates = { minute: { from: 4 * 86400000, to: 5 * 86400000 }, hour: null };
    const r = chooseSource({ ...base, aggregates, from: 0, to: 5 * 86400000, rowsInRange: 1000 });
    expect(r).toMatchObject({ ok: true, res: 'raw' });
  });
  it('quá giới hạn quét: có tổng hợp thì dùng phút (hoặc giờ), không có thì decimate xấp xỉ', () => {
    const big = { rowsInRange: 1e8 };
    expect(chooseSource({ ...base, from: 0, to: H, ...big })).toMatchObject({
      ok: true,
      res: '1m',
    });
    const onlyHour = { minute: null, hour: base.aggregates.hour };
    expect(chooseSource({ ...base, aggregates: onlyHour, from: 0, to: H, ...big })).toMatchObject({
      ok: true,
      res: '1h',
    });
    expect(chooseSource({ ...base, aggregates: null, from: 0, to: H, ...big })).toEqual({
      ok: true,
      res: 'raw',
      reduce: 'decimate',
      approximate: true,
    });
  });
  it('res rõ ràng: NO_AGGREGATES và SCAN_LIMIT', () => {
    expect(
      chooseSource({ ...base, aggregates: null, res: '1m', from: 0, to: H, rowsInRange: 1 }),
    ).toEqual({
      ok: false,
      error: 'NO_AGGREGATES',
    });
    expect(chooseSource({ ...base, res: 'raw', from: 0, to: H, rowsInRange: 1e8 })).toEqual({
      ok: false,
      error: 'SCAN_LIMIT',
    });
    expect(chooseSource({ ...base, res: '1h', from: 0, to: H, rowsInRange: 1e8 })).toMatchObject({
      ok: true,
      res: '1h',
    });
  });
});

describe('nearestPoint', () => {
  const t = [10, 20, 40, 80];
  it('chỉ số điểm gần nhất, hòa thì điểm trước', () => {
    expect(nearestPoint(t, 12)).toBe(0);
    expect(nearestPoint(t, 15)).toBe(0);
    expect(nearestPoint(t, 16)).toBe(1);
    expect(nearestPoint(t, 59)).toBe(2);
    expect(nearestPoint(t, 1000)).toBe(3);
    expect(nearestPoint(t, -5)).toBe(0);
    expect(nearestPoint([], 5)).toBe(-1);
    expect(nearestPoint(Float64Array.of(1, 2), 1.6)).toBe(1);
  });
});

describe('không dùng múi giờ cục bộ', () => {
  it('mã nguồn của gói không gọi Date cục bộ hay Intl', () => {
    const dir = resolve(__dirname);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(
        /new Date\(|Date\.now|Date\.parse|\.getHours|\.getDate|\.getMonth|\.getFullYear|toLocale|Intl\./,
      );
    }
  });
});
