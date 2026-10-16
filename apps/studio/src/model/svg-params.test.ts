// Đọc và ghi tham số của binding SVG, kiểm khoảng cục bộ (feature 008, T072; contract binding-animation §4, studio-svg-editor §5).
import { describe, expect, it } from 'vitest';
import type { Binding04 } from '@mat/project-schema';
import { rowById } from './animation-catalog.ts';
import {
  checkParam,
  checkRanges,
  outputKindOf,
  paramPatch,
  parseScalar,
  readParam,
  sortRanges,
} from './svg-params.ts';

const b = (extra: Partial<Binding04> = {}): Binding04 =>
  ({
    id: 'x',
    target: 'effect.blink',
    source: { type: 'tag', tagId: 'T' },
    transform: { kind: 'direct' },
    ...extra,
  }) as Binding04;

describe('đọc và ghi tham số (khóa có dấu chấm là khối `format`)', () => {
  it('đọc khóa phẳng và khóa của format', () => {
    expect(readParam(b({ period: 600 }), 'period')).toBe(600);
    expect(readParam(b({ format: { decimals: 2 } }), 'format.decimals')).toBe(2);
    expect(readParam(b(), 'format.decimals')).toBeUndefined();
  });

  it('ghi: khóa phẳng; format giữ khóa khác; bỏ khóa cuối thì bỏ cả khối', () => {
    expect(paramPatch(b(), 'period', 800)).toEqual({ period: 800 });
    expect(paramPatch(b({ format: { decimals: 1, prefix: 'A' } }), 'format.decimals', 3)).toEqual({
      format: { decimals: 3, prefix: 'A' },
    });
    expect(paramPatch(b({ format: { decimals: 1 } }), 'format.decimals', undefined)).toEqual({
      format: undefined,
    });
    expect(paramPatch(b({ period: 800 }), 'period', undefined)).toEqual({ period: undefined });
  });
});

describe('kiểm tham số cục bộ theo đặc tả của mục', () => {
  const spec = (row: string, key: string) => rowById(row)!.params.find((p) => p.key === key)!;
  it('số nguyên và khoảng: chu kỳ nhấp nháy 400-5000 (300 ms bị từ chối)', () => {
    const p = spec('blink', 'period');
    expect(checkParam(p, 300)).toBe('range');
    expect(checkParam(p, 400)).toBeNull();
    expect(checkParam(p, 5000)).toBeNull();
    expect(checkParam(p, 5001)).toBe('range');
    expect(checkParam(p, 450.5)).toBe('int');
    expect(checkParam(p, 'abc')).toBe('type');
  });
  it('số thực 0-0,9 của độ mờ thấp; 0-300 của tốc độ dòng chảy', () => {
    expect(checkParam(spec('blink', 'minOpacity'), 0.91)).toBe('range');
    expect(checkParam(spec('blink', 'minOpacity'), 0.9)).toBeNull();
    expect(checkParam(spec('flow', 'speed'), 301)).toBe('range');
    expect(checkParam(spec('flow', 'speed'), 0)).toBeNull();
  });
  it('chuỗi dài quá giới hạn và giá trị không hợp bool', () => {
    expect(checkParam(spec('flow', 'dash'), 'x'.repeat(65))).toBe('range');
    expect(checkParam(spec('flow', 'dash'), '12 8')).toBeNull();
    expect(checkParam(spec('flow', 'reverse'), 'yes')).toBe('type');
  });
});

describe('kiểm khoảng của phép Khoảng (E_RANGE hiện ngay tại ô)', () => {
  it('khoảng hợp lệ, khoảng mở đầu cuối, thứ tự theo từ', () => {
    const r = [
      { from: 50, value: 1 },
      { to: 50, value: 0 },
    ];
    expect(checkRanges(r)).toEqual([]);
    expect(sortRanges(r).map((x) => x.value)).toEqual([0, 1]);
  });
  it('từ >= đến báo lỗi ở chính dòng đó', () => {
    expect(checkRanges([{ from: 10, to: 10, value: 1 }])).toEqual([{ index: 0, error: 'order' }]);
    expect(checkRanges([{ from: 20, to: 10, value: 1 }])).toEqual([{ index: 0, error: 'order' }]);
  });
  it('chồng nhau: báo ở khoảng đứng sau (theo thứ tự từ), đúng chỉ số gốc', () => {
    const r = [
      { from: 0, to: 60, value: 'a' },
      { from: 40, to: 100, value: 'b' },
    ];
    expect(checkRanges(r)).toEqual([{ index: 1, error: 'overlap' }]);
    // Đảo thứ tự trong mảng: vẫn báo ở khoảng có `từ` lớn hơn (chỉ số 0 của mảng).
    expect(checkRanges([r[1]!, r[0]!])).toEqual([{ index: 0, error: 'overlap' }]);
  });
  it('liền kề (đến = từ) không chồng', () => {
    expect(
      checkRanges([
        { from: 0, to: 50, value: 1 },
        { from: 50, to: 100, value: 2 },
      ]),
    ).toEqual([]);
  });
});

describe('giá trị ra theo mục và đọc giá trị gõ tay', () => {
  it('loại giá trị ra của từng mục', () => {
    expect(outputKindOf('text')).toBe('text');
    expect(outputKindOf('fill')).toBe('color');
    expect(outputKindOf('stroke')).toBe('color');
    expect(outputKindOf('visibility')).toBe('visibility');
    expect(outputKindOf('blink')).toBe('bool');
    expect(outputKindOf('rotate')).toBe('number');
    expect(outputKindOf('opacity')).toBe('number');
  });
  it('đọc số với dấu chấm, từ chối dấu phẩy và chữ', () => {
    expect(parseScalar('12.5', 'number')).toEqual({ ok: true, value: 12.5 });
    expect(parseScalar('12,5', 'number')).toEqual({ ok: false });
    expect(parseScalar('abc', 'number')).toEqual({ ok: false });
    expect(parseScalar('#ff0000', 'color')).toEqual({ ok: true, value: '#ff0000' });
    expect(parseScalar('red', 'color')).toEqual({ ok: false });
    expect(parseScalar('Đang chạy', 'text')).toEqual({ ok: true, value: 'Đang chạy' });
    expect(parseScalar('true', 'bool')).toEqual({ ok: true, value: true });
    expect(parseScalar('hidden', 'visibility')).toEqual({ ok: true, value: 'hidden' });
    expect(parseScalar('xx', 'visibility')).toEqual({ ok: false });
  });
});
