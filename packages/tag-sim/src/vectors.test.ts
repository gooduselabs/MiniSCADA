// Bộ vector chung TS ↔ C++ (tests/sim-vectors): bằng từng bit; U(seed, k) với k >= 2^32; sinTurns.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashU, simValue, sinTurns, type SimConfig, type TagDataType } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/sim-vectors');

interface Suite {
  name: string;
  sim: SimConfig;
  type: TagDataType;
  cases: { t: number; writes?: (number | boolean | string)[]; value: number | boolean | string }[];
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'legacy.json');
const suiteFiles = files.filter((f) => !['sin-turns.json', 'hash.json'].includes(f));

describe('tests/sim-vectors', () => {
  it('has a file per generator, each generator x type with at least 10 cases', () => {
    expect(suiteFiles.sort()).toEqual([
      'const.json',
      'manual.json',
      'ramp.json',
      'random.json',
      'sine.json',
      'square.json',
    ]);
    const need: Record<string, string[]> = {
      const: [
        'BOOL',
        'INT16',
        'UINT16',
        'INT32',
        'UINT32',
        'INT64',
        'UINT64',
        'FLOAT32',
        'FLOAT64',
        'STRING',
      ],
      ramp: ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT32', 'FLOAT64'],
      sine: ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT32', 'FLOAT64'],
      random: [
        'BOOL',
        'INT16',
        'UINT16',
        'INT32',
        'UINT32',
        'INT64',
        'UINT64',
        'FLOAT32',
        'FLOAT64',
      ],
      square: [
        'BOOL',
        'INT16',
        'UINT16',
        'INT32',
        'UINT32',
        'INT64',
        'UINT64',
        'FLOAT32',
        'FLOAT64',
      ],
      manual: [
        'BOOL',
        'INT16',
        'UINT16',
        'INT32',
        'UINT32',
        'INT64',
        'UINT64',
        'FLOAT32',
        'FLOAT64',
        'STRING',
      ],
    };
    for (const [kind, types] of Object.entries(need)) {
      const { suites } = JSON.parse(readFileSync(join(DIR, `${kind}.json`), 'utf8')) as {
        suites: Suite[];
      };
      for (const ty of types) {
        const n = suites.filter((s) => s.type === ty).reduce((a, s) => a + s.cases.length, 0);
        expect(n, `${kind} x ${ty}`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  for (const f of suiteFiles) {
    const { suites } = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { suites: Suite[] };
    describe(f, () => {
      for (const s of suites) {
        it(s.name, () => {
          for (const c of s.cases) {
            const last =
              c.writes && c.writes.length > 0 ? c.writes[c.writes.length - 1] : undefined;
            const got = simValue(s.sim, c.t, s.type, last);
            if (s.type === 'INT64' || s.type === 'UINT64')
              expect(got, `t=${c.t}`).toBe(BigInt(c.value as string));
            else if (typeof c.value === 'number')
              expect(Object.is(got, c.value), `t=${c.t} got ${String(got)}`).toBe(true);
            else expect(got, `t=${c.t}`).toBe(c.value);
          }
        });
      }
    });
  }

  it('contract values: sine centre 50 amplitude 25 period 20000 phase 0.25 as FLOAT32', () => {
    const sim: SimConfig = {
      kind: 'sine',
      center: 50,
      amplitude: 25,
      periodMs: 20000,
      phase: 0.25,
    };
    expect(simValue(sim, 0, 'FLOAT32')).toBe(75);
    expect(simValue(sim, 1791601205123, 'FLOAT32')).toBe(49.03419876098633);
  });

  it('sinTurns matches the vectors bit for bit', () => {
    const { cases } = JSON.parse(readFileSync(join(DIR, 'sin-turns.json'), 'utf8')) as {
      cases: { f: number; value: number }[];
    };
    expect(cases.length).toBeGreaterThan(100);
    for (const c of cases) expect(Object.is(sinTurns(c.f), c.value), `f=${c.f}`).toBe(true);
  });

  it('U(seed, k) matches the vectors, including k >= 2^32 (the k_hi part)', () => {
    const { cases } = JSON.parse(readFileSync(join(DIR, 'hash.json'), 'utf8')) as {
      cases: { seed: number; k: number; u: number }[];
    };
    expect(cases.some((c) => c.k >= 2 ** 32)).toBe(true);
    for (const c of cases) expect(hashU(c.seed, c.k), `seed=${c.seed} k=${c.k}`).toBe(c.u);
  });

  it('U depends on k_hi: k and k + 2^32 differ', () => {
    let differ = 0;
    for (let k = 0; k < 50; k++) if (hashU(1, k) !== hashU(1, k + 2 ** 32)) differ++;
    expect(differ).toBe(50);
  });
});
