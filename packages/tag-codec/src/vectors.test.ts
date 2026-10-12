/* eslint-disable @typescript-eslint/no-explicit-any -- ca vector đọc từ JSON, kiểu theo từng file */
// Bộ vector chung TS ↔ C++ (tests/codec-vectors): địa chỉ, số, chuỗi, scaling, bit. So từng bit.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyBit,
  decodeNumber,
  decodeString,
  encodeNumber,
  encodeString,
  maskWrite,
  packBits,
  parseAddress,
  registerBit,
  scaleRead,
  scaleWrite,
  unpackBits,
  type ByteOrder,
  type NumericType,
  type Scaling,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/codec-vectors');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T;
const regsOf = (hex: string[]): number[] => hex.map((h) => parseInt(h, 16));
const hexOf = (regs: number[]): string[] =>
  regs.map((r) => r.toString(16).toUpperCase().padStart(4, '0'));
const special = (v: unknown): unknown =>
  v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v;

describe('address.json', () => {
  const cases = load<{ cases: Record<string, any>[] }>('address.json').cases;
  it('has the boundary cases of FR-015', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_AREA', 'E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = parseAddress(c.address, {
        addressBase: c.addressBase,
        rawType: c.rawType,
        stringLength: c.stringLength,
        access: c.access,
      });
      if (c.expect.error) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe(c.expect.error);
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect({
        normalized: r.normalized,
        area: r.area,
        fcRead: r.fcRead,
        fcWrite: r.fcWrite,
        offset: r.offset,
        registers: r.registers,
        bit: r.bit,
        warnings: r.warnings,
      }).toEqual({
        normalized: c.expect.normalized,
        area: c.expect.area,
        fcRead: c.expect.fcRead,
        fcWrite: c.expect.fcWrite,
        offset: c.expect.offset,
        registers: c.expect.registers,
        bit: c.expect.bit,
        warnings: c.expect.warnings ?? [],
      });
    });
  }
});

describe('numeric.json', () => {
  const cases = load<{ cases: Record<string, any>[] }>('numeric.json').cases;
  it('covers every type and the four byte orders', () => {
    const types = new Set(cases.map((c) => c.type));
    expect([...types].sort()).toEqual(
      ['FLOAT32', 'FLOAT64', 'INT16', 'INT32', 'INT64', 'UINT16', 'UINT32', 'UINT64'].sort(),
    );
    expect(new Set(cases.map((c) => c.byteOrder))).toEqual(
      new Set(['ABCD', 'CDAB', 'BADC', 'DCBA']),
    );
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = decodeNumber(c.type as NumericType, c.byteOrder as ByteOrder, regsOf(c.registers));
      if (c.expect.invalid) {
        expect(r).toEqual({ ok: false, reason: c.expect.invalid });
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (c.type === 'INT64' || c.type === 'UINT64') expect(r.value).toBe(BigInt(c.expect.value));
      else expect(Object.is(r.value, c.expect.value)).toBe(true);
      if (c.encode) {
        const v =
          c.type === 'INT64' || c.type === 'UINT64' ? BigInt(c.expect.value) : c.expect.value;
        expect(hexOf(encodeNumber(c.type, c.byteOrder, v))).toEqual(c.registers);
      }
    });
  }
});

describe('string.json', () => {
  const cases = load<{ cases: Record<string, any>[] }>('string.json').cases;
  for (const c of cases) {
    it(`${c.kind} ${c.name}`, () => {
      if (c.kind === 'decode') {
        expect(decodeString(c.length, c.byteOrder, regsOf(c.registers))).toBe(c.expect.text);
        return;
      }
      const r = encodeString(c.length, c.byteOrder, c.text);
      if (c.expect.error) expect(r).toEqual({ ok: false, error: c.expect.error });
      else expect(r.ok && hexOf(r.registers)).toEqual(c.expect.registers);
    });
  }
});

describe('scaling.json', () => {
  const j = load<{ read: Record<string, any>[]; write: Record<string, any>[] }>('scaling.json');
  for (const c of j.read) {
    it(`read ${c.name}`, () => {
      const r = scaleRead(c.raw, c.scaling as Scaling, c.tagType);
      expect(r.quality).toBe(c.expect.quality);
      expect(r.reason).toBe(c.expect.reason);
      expect(Object.is(r.value, c.expect.value)).toBe(true);
    });
  }
  for (const c of j.write) {
    it(`write ${c.name}`, () => {
      const r = scaleWrite(special(c.eng) as number, c.scaling as Scaling, c.rawType);
      if (c.expect.error) {
        expect(r).toEqual({ ok: false, error: c.expect.error });
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (c.rawType === 'INT64' || c.rawType === 'UINT64') expect(r.raw).toBe(BigInt(c.expect.raw));
      else expect(Object.is(r.raw, c.expect.raw)).toBe(true);
    });
  }
});

describe('bits.json', () => {
  const j = load<Record<string, Record<string, any>[]>>('bits.json');
  for (const c of j.unpack!) {
    it(`unpack ${c.name}`, () => {
      expect(
        unpackBits(
          c.bytes.map((h: string) => parseInt(h, 16)),
          c.count,
        ),
      ).toEqual(c.expect.bits);
    });
  }
  for (const c of j.pack!) {
    it(`pack ${c.name}`, () => {
      const bytes = packBits(c.bits).map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
      expect(bytes).toEqual(c.expect.bytes);
    });
  }
  for (const c of j.register!) {
    it(`register ${c.name}`, () => {
      expect(registerBit(parseInt(c.reg, 16), c.bit)).toBe(c.expect.value);
    });
  }
  for (const c of j.mask!) {
    it(`mask ${c.name}`, () => {
      const m = maskWrite(c.bit, c.value);
      expect(hexOf([m.and, m.or])).toEqual([c.expect.and, c.expect.or]);
    });
  }
  for (const c of j.rmw!) {
    it(`rmw ${c.name}`, () => {
      expect(hexOf([applyBit(parseInt(c.reg, 16), c.bit, c.value)])).toEqual([c.expect.reg]);
    });
  }
});
