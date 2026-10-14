import { describe, expect, it } from 'vitest';
import {
  formatAlarmText,
  formatNumber,
  formatNumberPlain,
  roundDecimalText,
  shortestDouble,
} from './index.ts';
import type { TextContext } from './index.ts';

const ctx = (o: Partial<TextContext> = {}): TextContext => ({
  name: 'Mức bồn',
  tag: 'T1',
  unit: '%',
  limitName: 'H',
  area: 'Chung',
  reason: '',
  ...o,
});

describe('shortestDouble', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [91.2, '91.2'],
    [-5.5, '-5.5'],
    [1e21, '1000000000000000000000'],
    [1.5e-7, '0.00000015'],
    [5e-7, '0.0000005'],
    [123456789.125, '123456789.125'],
    [0.1 + 0.2, '0.30000000000000004'],
    [-1e-7, '-0.0000001'],
  ])('%s → %s', (v, s) => {
    expect(shortestDouble(v)).toBe(s);
  });
});

describe('làm tròn nửa ra xa 0', () => {
  it.each([
    ['1.005', 2, '1,01'],
    ['-2.5', 0, '-3'],
    ['2.5', 0, '3'],
    ['0.5', 0, '1'],
    ['-0.004', 2, '0,00'],
    ['0.995', 2, '1,00'],
    ['9.995', 2, '10,00'],
    ['99.5', 0, '100'],
    ['999.9996', 3, '1000,000'],
    ['0', 3, '0,000'],
    ['12', 0, '12'],
    ['-0.5', 0, '-1'],
  ])('%s n=%d → %s', (t, n, out) => {
    expect(roundDecimalText(t, n)).toBe(out);
  });
  it('{value} bỏ số 0 thừa nhưng không bỏ chữ số nguyên', () => {
    expect(formatNumberPlain(100)).toBe('100');
    expect(formatNumberPlain(0.5)).toBe('0,5');
    expect(formatNumberPlain(91.2)).toBe('91,2');
    expect(formatNumber(2, 3)).toBe('2,000');
  });
});

describe('formatAlarmText', () => {
  it('mẫu mặc định dạng ngưỡng cao', () => {
    expect(
      formatAlarmText('{name} cao: {value} {unit} (ngưỡng {limit})', ctx({ value: 81, limit: 80 })),
    ).toBe('Mức bồn cao: 81 % (ngưỡng 80)');
  });
  it('xóa "()" rỗng, gộp và cắt khoảng trắng', () => {
    expect(formatAlarmText('  {name}:   mất ( {reason} )  ', ctx())).toBe('Mức bồn: mất');
  });
  it('giá trị không hữu hạn hoặc thiếu: n/a', () => {
    expect(formatAlarmText('{value}', ctx({ value: Number.NaN }))).toBe('n/a');
    expect(formatAlarmText('{value:2}', ctx())).toBe('n/a');
  });
  it('thẻ lạ giữ nguyên', () => {
    expect(formatAlarmText('{abc} {value:7}', ctx({ value: 1 }))).toBe('{abc} {value:7}');
  });
  it('nhãn và Bật/Tắt áp cho {value}, không áp cho {limit}', () => {
    expect(formatAlarmText('{value}', ctx({ value: 1, isBool: true }))).toBe('Bật');
    expect(formatAlarmText('{value}', ctx({ value: 2, labels: { '2': 'Tự động' } }))).toBe(
      'Tự động',
    );
    expect(formatAlarmText('{limit}', ctx({ limit: 1, isBool: true }))).toBe('1');
  });
  it('cắt 200 điểm mã: 199 + "…", không tách dấu kết hợp', () => {
    expect(formatAlarmText('x'.repeat(200), ctx())).toBe('x'.repeat(200));
    expect(formatAlarmText('x'.repeat(201), ctx())).toBe(`${'x'.repeat(199)}…`);
    expect(formatAlarmText(`${'x'.repeat(198)}ézzz`, ctx())).toBe(`${'x'.repeat(198)}…`);
    expect(Array.from(formatAlarmText('😀'.repeat(300), ctx())).length).toBe(200);
  });
});
