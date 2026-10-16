// M4 (rà soát 010): formatNumber đúng khi |v|·10^d vượt 2^53 hoặc |v| >= 1e21 (không dạng mũ, không Infinity).
import { describe, expect, it } from 'vitest';
import { formatNumber } from './format.ts';

describe('formatNumber: giá trị lớn', () => {
  it('|v|·10^d vượt 2^53 vẫn in đủ chữ số, không dạng mũ', () => {
    expect(formatNumber(1e15, 3)).toBe('1.000.000.000.000.000,000');
    expect(formatNumber(2 ** 53, 0)).toBe('9.007.199.254.740.992');
    expect(formatNumber(-123456789012345.6, 1)).toBe('-123.456.789.012.345,6');
  });
  it('|v| >= 1e21 và 1e308 không in dạng mũ hay Infinity', () => {
    expect(formatNumber(1e21, 0)).toBe('1.000.000.000.000.000.000.000');
    expect(formatNumber(1e21, 2)).toBe('1.000.000.000.000.000.000.000,00');
    const huge = formatNumber(1.7976931348623157e308, 6);
    expect(huge).not.toMatch(/e|Infinity|NaN/i);
    expect(huge.replace(/[.,]/g, '').length).toBe(309 + 6);
  });
  it('giá trị thường không đổi', () => {
    expect(formatNumber(1277.7, 1)).toBe('1.277,7');
    expect(formatNumber(-0.04, 1)).toBe('0,0');
  });
});
