// Bộ vector địa chỉ MQTT chung TS ↔ C++ (tests/mqtt-vectors/address.json, feature 022).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mqttTopicMatches, parseMqttAddress } from './index.ts';

interface Case {
  name: string;
  address: string;
  expect: Record<string, unknown>;
}
interface Match {
  filter: string;
  topic: string;
  expect: boolean;
}

const FILE = resolve(__dirname, '../../../tests/mqtt-vectors/address.json');
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Case[]; match: Match[] };

describe('mqtt-vectors/address.json', () => {
  it('đủ ca, đủ mã lỗi và đủ hướng', () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(50);
    const codes = new Set(doc.cases.map((c) => c.expect.error).filter(Boolean));
    expect([...codes].sort()).toEqual(['E_ADDR_RANGE', 'E_ADDR_SYNTAX']);
    const dirs = new Set(doc.cases.map((c) => c.expect.dir).filter(Boolean));
    expect([...dirs].sort()).toEqual(['both', 'pub', 'sub']);
  });
  for (const c of doc.cases)
    it(c.name, () => {
      const r = parseMqttAddress(c.address);
      if (c.expect.error) expect(r).toEqual({ ok: false, error: c.expect.error });
      else expect(r).toEqual({ ok: true, ...c.expect });
    });
  for (const m of doc.match)
    it(`match ${m.filter} ~ ${m.topic}`, () => {
      expect(mqttTopicMatches(m.filter, m.topic)).toBe(m.expect);
    });
});
