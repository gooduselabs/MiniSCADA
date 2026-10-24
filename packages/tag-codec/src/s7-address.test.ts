/* eslint-disable @typescript-eslint/no-explicit-any -- ca vector đọc từ JSON */
// Bộ vector địa chỉ S7 chung TS ↔ C++ (tests/s7-vectors/address.json, feature 016).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseS7Address, s7TypeSize, s7WriteSize } from './index.ts';

const FILE = resolve(__dirname, '../../../tests/s7-vectors/address.json');
const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Record<string, any>[] }).cases;

describe('s7-vectors/address.json', () => {
  it('đủ ca và đủ mã lỗi', () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_AREA', 'E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
    const types = new Set(cases.map((c) => c.expect.s7Type).filter(Boolean));
    expect(types.size).toBe(10);
  });
  for (const c of cases)
    it(c.name, () => {
      const r = parseS7Address(c.address, {
        rawType: c.rawType,
        stringLength: c.stringLength,
        access: c.access,
      });
      if (c.expect.error) {
        expect(r).toEqual({ ok: false, error: c.expect.error });
        return;
      }
      expect(r).toEqual({ ok: true, ...c.expect });
    });
});

describe('cỡ', () => {
  it('s7TypeSize, s7WriteSize', () => {
    expect(s7TypeSize('STRING', 10)).toBe(12);
    expect(s7WriteSize('STRING', 12)).toBe(11);
    expect(s7WriteSize('REAL', 4)).toBe(4);
    expect(s7TypeSize('CHAR', 3)).toBe(3);
  });
});
