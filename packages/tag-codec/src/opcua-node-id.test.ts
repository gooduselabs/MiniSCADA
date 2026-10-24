// Bộ vector NodeId OPC UA chung TS ↔ C++ (tests/opcua-vectors/nodeid.json, feature 019).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOpcUaNodeId } from './index.ts';

interface Case {
  name: string;
  address: string;
  expect: { error?: string; ns?: number; idType?: string; id?: string; normalized?: string };
}

const FILE = resolve(__dirname, '../../../tests/opcua-vectors/nodeid.json');
const cases = (JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Case[] }).cases;

describe('opcua-vectors/nodeid.json', () => {
  it('đủ ca, đủ mã lỗi và đủ loại id', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const codes = new Set(cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
    const kinds = new Set(cases.map((c) => c.expect.idType).filter(Boolean));
    expect([...kinds].sort()).toEqual(['b', 'g', 'i', 's']);
  });
  for (const c of cases)
    it(c.name, () => {
      const r = parseOpcUaNodeId(c.address);
      if (c.expect.error) expect(r).toEqual({ ok: false, error: c.expect.error });
      else expect(r).toEqual({ ok: true, ...c.expect });
    });
});
