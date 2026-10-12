// interpret(): bảng "cách hiểu" của Thử kết nối (R22; FR-044): mọi kiểu x 4 thứ tự cho 1–4 thanh ghi, và bit.
import { describe, expect, it } from 'vitest';
import { interpretBits, interpretRegisters } from './index.ts';

const row = (rows: ReturnType<typeof interpretRegisters>, type: string, order?: string) =>
  rows.find((r) => r.type === type && r.byteOrder === order);

describe('interpretRegisters', () => {
  it('1 register: INT16 and UINT16 only', () => {
    const rows = interpretRegisters([0xfedc]);
    expect(rows.map((r) => r.type)).toEqual(['INT16', 'UINT16']);
    expect(rows[0]).toMatchObject({ type: 'INT16', value: -292, text: '-292' });
    expect(rows[1]).toMatchObject({ type: 'UINT16', value: 65244, text: '65244' });
    expect(rows[0]!.byteOrder).toBeUndefined();
  });
  it('2 registers: 16-bit rows of the first register plus INT32, UINT32, FLOAT32 in four orders', () => {
    const rows = interpretRegisters([0x42f6, 0xe979]);
    expect(rows).toHaveLength(2 + 12);
    expect(row(rows, 'FLOAT32', 'ABCD')).toMatchObject({
      value: Math.fround(123.456),
      invalid: false,
    });
    expect(row(rows, 'UINT32', 'ABCD')!.value).toBe(0x42f6e979);
    expect(row(rows, 'UINT32', 'CDAB')!.value).toBe(0xe97942f6);
    expect(row(rows, 'UINT32', 'BADC')!.value).toBe(0xf64279e9);
    expect(row(rows, 'UINT32', 'DCBA')!.value).toBe(0x79e9f642);
    expect(row(rows, 'INT32', 'CDAB')!.value).toBe(0xe97942f6 - 2 ** 32);
  });
  it('3 registers: the same rows as 2', () => {
    expect(interpretRegisters([1, 2, 3])).toHaveLength(14);
  });
  it('4 registers: adds INT64, UINT64, FLOAT64 in four orders', () => {
    const rows = interpretRegisters([0x0102, 0x0304, 0x0506, 0x0708]);
    expect(rows).toHaveLength(2 + 12 + 12);
    expect(row(rows, 'INT64', 'ABCD')).toMatchObject({
      value: 0x0102030405060708n,
      text: '72623859790382856',
    });
    expect(row(rows, 'INT64', 'CDAB')!.value).toBe(0x0708050603040102n);
    expect(row(rows, 'INT64', 'BADC')!.value).toBe(0x0201040306050807n);
    expect(row(rows, 'INT64', 'DCBA')!.value).toBe(0x0807060504030201n);
    expect(row(rows, 'UINT64', 'DCBA')!.value).toBe(0x0807060504030201n);
  });
  it('FLOAT64 of the pi pattern', () => {
    const rows = interpretRegisters([0x4009, 0x21fb, 0x5444, 0x2d18]);
    expect(row(rows, 'FLOAT64', 'ABCD')!.value).toBe(Math.PI);
  });
  it('a NaN or infinity float row is invalid, without a value', () => {
    const rows = interpretRegisters([0x7fc0, 0x0000]);
    expect(row(rows, 'FLOAT32', 'ABCD')).toMatchObject({
      invalid: true,
      value: null,
      text: 'INVALID_VALUE',
    });
    expect(row(rows, 'FLOAT32', 'DCBA')!.invalid).toBe(false); // 0x0000007F lần lượt: số nhỏ chuẩn hóa
  });
  it('0 registers or more than 4: no rows', () => {
    expect(interpretRegisters([])).toEqual([]);
    expect(interpretRegisters([1, 2, 3, 4, 5])).toHaveLength(26);
  });
  it('the 16-bit rows ignore the byte order', () => {
    const rows = interpretRegisters([0x1234, 0x5678]);
    expect(
      rows
        .filter((r) => r.type === 'INT16' || r.type === 'UINT16')
        .every((r) => r.byteOrder === undefined),
    ).toBe(true);
  });
});

describe('interpretBits (coil, DI)', () => {
  it('unpacks the response bytes, lowest bit first, and reports the count asked', () => {
    expect(interpretBits([0xcd, 0x6b, 0x01], 19)).toEqual(
      [1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0].map((v, i) => ({
        index: i,
        value: v === 1,
      })),
    );
  });
  it('one bit', () => {
    expect(interpretBits([0x01], 1)).toEqual([{ index: 0, value: true }]);
  });
});
