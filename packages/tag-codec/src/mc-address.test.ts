/* eslint-disable @typescript-eslint/no-explicit-any -- ca vector đọc từ JSON */
// Vector địa chỉ MC chung TS ↔ C++ (tests/mc-vectors/address.json; feature 017).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMcAddress } from './index.ts';

const cases = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/mc-vectors/address.json'), 'utf8'),
).cases as Record<string, any>[];

describe('mc-vectors/address.json', () => {
  it('có đủ ba mã lỗi và mọi thiết bị', () => {
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_AREA', 'E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
    const devices = new Set(cases.map((c) => c.expect.device).filter(Boolean));
    expect(devices.size).toBe(13);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = parseMcAddress(c.address, {
        rawType: c.rawType,
        stringLength: c.stringLength,
        access: c.access,
        xyNotation: c.xyNotation,
      });
      if (c.expect.error) {
        expect(r).toEqual({ ok: false, error: c.expect.error });
        return;
      }
      expect(r).toEqual({ ok: true, ...c.expect });
    });
  }
});
