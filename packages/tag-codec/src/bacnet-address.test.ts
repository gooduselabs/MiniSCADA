/* eslint-disable @typescript-eslint/no-explicit-any -- ca vector đọc từ JSON */
// Vector địa chỉ BACnet chung TS ↔ C++ (tests/bacnet-vectors/address.json; drivers/bacnet/tests/bacnet_codec_test.cpp).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACNET_ADDRESS_HINTS, parseBacnetAddress } from './index.ts';

const FILE = resolve(__dirname, '../../../tests/bacnet-vectors/address.json');
const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Record<string, any>[] }).cases;

describe('bacnet-vectors/address.json', () => {
  it('covers every object type and every error code', () => {
    const types = new Set(cases.map((c) => c.expect.objectType).filter(Boolean));
    expect([...types].sort()).toEqual([
      'AI',
      'AO',
      'AV',
      'BI',
      'BO',
      'BV',
      'DEV',
      'MSI',
      'MSO',
      'MSV',
    ]);
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_AREA', 'E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = parseBacnetAddress(c.address, { rawType: c.rawType, access: c.access });
      if (c.expect.error) {
        expect(r).toEqual({ ok: false, error: c.expect.error });
        return;
      }
      expect(r).toEqual({ ok: true, ...c.expect });
    });
  }
});

describe('bacnet hints', () => {
  it('every hint example is a valid address of its type', () => {
    for (const h of BACNET_ADDRESS_HINTS) {
      const r = parseBacnetAddress(h.example, {
        rawType: h.rawType,
        access: h.example.includes('@') ? 'RW' : 'R',
      });
      expect(r.ok, h.example).toBe(true);
    }
  });
});
