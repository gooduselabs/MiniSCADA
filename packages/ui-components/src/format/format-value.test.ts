import { describe, expect, it } from 'vitest';
import type { ValueTable } from '@mat/expression';
import type { TagInfo, TagState } from '../host/types.ts';
import { formatValue } from './format-value.ts';

const good = (value: TagState['value']): TagState => ({ value, quality: 'GOOD' });
const info = (over: Partial<TagInfo> = {}): TagInfo => ({
  id: 't',
  type: 'FLOAT32',
  access: 'R',
  kind: 'external',
  ...over,
});

describe('formatValue: số', () => {
  it('theo decimals, dấu chấm, không nhóm hàng nghìn', () => {
    expect(formatValue(good(1234.5678), info(), { decimals: 1 }).text).toBe('1234.6');
    expect(formatValue(good(1234.5), info(), { decimals: 3 }).text).toBe('1234.500');
    expect(formatValue(good(1234567), info(), { decimals: 0 }).text).toBe('1234567');
  });
  it('làm tròn ra xa số không và không ra "-0.0"', () => {
    expect(formatValue(good(-0.04), info(), { decimals: 1 }).text).toBe('0.0');
    expect(formatValue(good(2.5), info(), { decimals: 0 }).text).toBe('3');
  });
  it('không đặt decimals: kiểu nguyên 0 số lẻ, kiểu thực giữ ngắn gọn', () => {
    expect(formatValue(good(42), info({ type: 'INT16' }), {}).text).toBe('42');
    expect(formatValue(good(12.5), info(), {}).text).toBe('12.5');
  });
  it('NaN và vô cực hiện dấu gạch, không ném lỗi', () => {
    expect(formatValue(good(NaN), info(), { decimals: 1 }).text).toBe('—');
    expect(formatValue(good(Infinity), info(), {}).text).toBe('—');
  });
  it('giá trị null hiện dấu gạch; Tag lạ (UNKNOWN) hiện "?"', () => {
    expect(formatValue({ value: null, quality: 'GOOD' }, info(), {}).text).toBe('—');
    expect(formatValue({ value: null, quality: 'UNKNOWN' }, undefined, {}).text).toBe('?');
  });
});

describe('formatValue: đơn vị', () => {
  it('lấy theo Tag khi không đặt; đặt chuỗi thì ghi đè; null thì bỏ', () => {
    expect(formatValue(good(1), info({ unit: 'bar' }), {}).unit).toBe('bar');
    expect(formatValue(good(1), info({ unit: 'bar' }), { unit: 'kPa' }).unit).toBe('kPa');
    expect(formatValue(good(1), info({ unit: 'bar' }), { unit: null }).unit).toBe('');
    expect(formatValue(good(1), undefined, {}).unit).toBe('');
  });
});

describe('formatValue: BOOL', () => {
  it('mặc định Bật/Tắt; boolWords đổi chữ (tắt trước, bật sau)', () => {
    const b = info({ type: 'BOOL' });
    expect(formatValue(good(true), b, {}).text).toBe('Bật');
    expect(formatValue(good(false), b, {}).text).toBe('Tắt');
    expect(formatValue(good(true), b, { boolWords: ['Dừng', 'Chạy'] }).text).toBe('Chạy');
    expect(formatValue(good(false), b, { boolWords: ['Dừng', 'Chạy'] }).text).toBe('Dừng');
  });
  it('Tag BOOL nhận số 0/1 từ nguồn', () => {
    expect(formatValue(good(1), info({ type: 'BOOL' }), {}).text).toBe('Bật');
  });
});

describe('formatValue: số nguyên 64 bit và chuỗi', () => {
  it('INT64/UINT64 dạng chuỗi hiện nguyên chuỗi, không mất chính xác', () => {
    const s = '9223372036854775807';
    expect(formatValue(good(s), info({ type: 'INT64' }), { decimals: 2 }).text).toBe(s);
    expect(formatValue(good('18446744073709551615'), info({ type: 'UINT64' }), {}).text).toBe(
      '18446744073709551615',
    );
  });
  it('STRING hiện nguyên chuỗi, kể cả ký tự HTML (không thoát ở đây, Lit sẽ thoát)', () => {
    expect(formatValue(good('<b>x</b>'), info({ type: 'STRING' }), {}).text).toBe('<b>x</b>');
  });
});

describe('formatValue: bảng giá trị', () => {
  const table: ValueTable = {
    entries: [
      { value: 0, text: 'Dừng', color: '#888888' },
      { value: 1, text: 'Chạy', color: '#15703a' },
      { from: 2, to: 10, text: 'Lỗi mức 2-10', color: '#c42b2b' },
    ],
    default: { text: 'Không rõ', color: '#555555' },
  };
  it('khớp mục: chữ và màu của bảng', () => {
    const r = formatValue(good(1), info({ type: 'UINT16' }), { table });
    expect(r.text).toBe('Chạy');
    expect(r.color).toBe('#15703a');
  });
  it('khoảng nửa mở và mặc định', () => {
    expect(formatValue(good(5), info(), { table }).text).toBe('Lỗi mức 2-10');
    expect(formatValue(good(10), info(), { table }).text).toBe('Không rõ');
    expect(formatValue(good(10), info(), { table }).color).toBe('#555555');
  });
  it('BOOL tra bảng như 1/0', () => {
    expect(formatValue(good(true), info({ type: 'BOOL' }), { table }).text).toBe('Chạy');
  });
  it('không khớp và không có default: dùng định dạng thường', () => {
    const t2: ValueTable = { entries: [{ value: 1, text: 'Một' }] };
    const r = formatValue(good(7), info({ type: 'INT16' }), { table: t2 });
    expect(r.text).toBe('7');
    expect(r.color).toBeUndefined();
  });
  it('INT64 chuỗi nhỏ vẫn tra được bảng', () => {
    expect(formatValue(good('1'), info({ type: 'INT64' }), { table }).text).toBe('Chạy');
  });
  it('STRING bỏ qua bảng', () => {
    expect(formatValue(good('abc'), info({ type: 'STRING' }), { table }).text).toBe('abc');
  });
  it('null hoặc không có giá trị: không tra bảng', () => {
    expect(formatValue({ value: null, quality: 'GOOD' }, info(), { table }).text).toBe('—');
  });
});
