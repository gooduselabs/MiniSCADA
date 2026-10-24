/* eslint-disable @typescript-eslint/no-explicit-any -- ca vector đọc từ JSON */
// Vector địa chỉ FINS chung TS ↔ C++ (tests/fins-vectors/address.json; drivers/fins/tests/address_test.cpp).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINS_ADDRESS_HINTS, finsWordCount, parseFinsAddress } from './index.ts';

const FILE = resolve(__dirname, '../../../tests/fins-vectors/address.json');
const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Record<string, any>[] }).cases;

describe('fins-vectors/address.json', () => {
  it('covers every area and every error code', () => {
    const areas = new Set(cases.map((c) => c.expect.area).filter(Boolean));
    expect([...areas].sort()).toEqual(['A', 'C', 'CIO', 'D', 'E', 'H', 'T', 'W']);
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_AREA', 'E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = parseFinsAddress(c.address, {
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
  }
});

describe('fins helpers', () => {
  it('counts words like the C++ wordCount', () => {
    expect(finsWordCount('BOOL')).toBe(1);
    expect(finsWordCount('FLOAT64')).toBe(4);
    expect(finsWordCount('STRING', 7)).toBe(4);
  });
  it('every hint example is a valid address', () => {
    for (const h of FINS_ADDRESS_HINTS) {
      const r = parseFinsAddress(h.example, {
        rawType: h.example.includes('.') ? 'BOOL' : 'UINT16',
      });
      expect(r.ok, h.example).toBe(true);
    }
  });
});
