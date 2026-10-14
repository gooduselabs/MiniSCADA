// Chạy toàn bộ tests/alarm-vectors/ bằng bản TS (T030): ca vector, fold, fingerprint, làm tròn, MANIFEST.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fingerprintHex,
  fingerprintString,
  fnv1a64Hex,
  FOLD_TABLE_SIZE,
  foldText,
  formatNumber,
} from './index.ts';
import { runVector } from './index.ts';
import type { AlarmVector, InstanceDef } from './index.ts';

const DIR = fileURLToPath(new URL('../../../tests/alarm-vectors/', import.meta.url));
const read = (f: string): unknown => JSON.parse(readFileSync(DIR + f, 'utf8'));
const GROUPS = [
  'digital',
  'limit-high',
  'limit-low',
  'deadband',
  'delay',
  'input-bad',
  'quality',
  'isa',
  'ack',
  'shelve',
  'disable',
  'chatter',
  'reconcile',
  'text',
  'clock',
  'order',
];

interface GroupFile {
  group: string;
  cases: AlarmVector[];
}

const groups = GROUPS.map((g) => read(`${g}.json`) as GroupFile);

describe('bộ vector: cấu trúc', () => {
  it('đủ 16 nhóm, mỗi nhóm >= 1 ca, tên duy nhất, tổng >= 60', () => {
    const names = new Set<string>();
    let total = 0;
    for (const g of groups) {
      expect(g.cases.length, g.group).toBeGreaterThanOrEqual(1);
      for (const c of g.cases) {
        expect(names.has(c.name), `trùng tên ${c.name}`).toBe(false);
        names.add(c.name);
        expect(c.group).toBe(g.group);
        total++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(60);
  });

  it('MANIFEST.json khớp sha256 từng file', () => {
    const manifest = read('MANIFEST.json') as { files: Record<string, string> };
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json')
      .sort();
    expect(Object.keys(manifest.files).sort()).toEqual(onDisk);
    for (const f of onDisk) {
      expect(
        createHash('sha256')
          .update(readFileSync(DIR + f))
          .digest('hex'),
        f,
      ).toBe(manifest.files[f]);
    }
  });
});

for (const g of groups) {
  describe(`vector ${g.group}`, () => {
    for (const c of g.cases) {
      it(c.name, () => {
        const r = runVector(c);
        expect(r.errors, `${c.name}: ${c.description ?? ''}`).toEqual([]);
        expect(r.ok).toBe(true);
      });
    }
  });
}

describe('foldText', () => {
  it('fold-table.json: 134 cặp, đúng kích thước bảng trong mã', () => {
    const t = read('fold-table.json') as { pairs: Array<{ char: string; out: string }> };
    expect(t.pairs.length).toBe(134);
    expect(FOLD_TABLE_SIZE).toBe(134);
    for (const p of t.pairs) expect(foldText(p.char), p.char).toBe(p.out);
  });
  it('fold.json: >= 40 cặp', () => {
    const t = read('fold.json') as { pairs: Array<{ in: string; out: string }> };
    expect(t.pairs.length).toBeGreaterThanOrEqual(40);
    for (const p of t.pairs) expect(foldText(p.in), JSON.stringify(p.in)).toBe(p.out);
  });
  it('idempotent trên mọi cặp (đầu ra gấp lần nữa không đổi trừ ký tự ngoài bảng)', () => {
    const t = read('fold.json') as { pairs: Array<{ in: string; out: string }> };
    for (const p of t.pairs) expect(foldText(p.out)).toBe(foldText(foldText(p.out)));
  });
});

describe('dấu vân tay', () => {
  interface FpFile {
    raw: Array<{ input: string; hex: string }>;
    cases: Array<{
      name: string;
      def: {
        kind: InstanceDef['kind'];
        tag?: string;
        device?: string;
        limit?: InstanceDef['limitName'];
        threshold?: number;
        trigger?: boolean;
        on?: InstanceDef['on'];
      };
      canonical: string;
      hex: string;
    }>;
  }
  const f = read('fingerprint.json') as FpFile;
  it('FNV-1a 64 trên chuỗi thô', () => {
    for (const r of f.raw) expect(fnv1a64Hex(r.input), JSON.stringify(r.input)).toBe(r.hex);
  });
  it('chuỗi chuẩn và hex từng loại điều kiện', () => {
    for (const c of f.cases) {
      const d = {
        kind: c.def.kind,
        tagId: c.def.tag ?? '',
        deviceId: c.def.device ?? '',
        limitName: c.def.limit ?? '',
        threshold: c.def.threshold ?? null,
        trigger: c.def.trigger ?? null,
        on: c.def.on ?? null,
      } as const;
      expect(fingerprintString(d), c.name).toBe(c.canonical);
      expect(fingerprintHex(d), c.name).toBe(c.hex);
    }
  });
});

describe('làm tròn {value:N}', () => {
  it('round-table.json: toàn bộ cặp khớp oracle thập phân', () => {
    const t = read('round-table.json') as { pairs: Array<{ v: number; n: number; out: string }> };
    expect(t.pairs.length).toBeGreaterThanOrEqual(1000);
    for (const p of t.pairs) expect(formatNumber(p.v, p.n), `${p.v} n=${p.n}`).toBe(p.out);
  });
});

describe('bộ chạy phát hiện sai lệch (không rỗng)', () => {
  const base = groups[0].cases[0]; // digital-true-basic
  it('ca gốc xanh và đủ lớn', () => {
    expect(runVector(base).ok).toBe(true);
    expect(base.expect.length).toBeGreaterThanOrEqual(4);
  });
  it('đổi occurrence kỳ vọng thì đỏ', () => {
    const v = structuredClone(base);
    v.expect[0].occurrence = 9;
    expect(runVector(v).ok).toBe(false);
  });
  it('thiếu một sự kiện kỳ vọng thì đỏ; thừa một sự kiện cũng đỏ (strict)', () => {
    const missing = structuredClone(base);
    missing.expect.pop();
    expect(runVector(missing).ok).toBe(false);
    const extra = structuredClone(base);
    extra.expect.push({ t: 5500, instance: 'DA', from: 'NORMAL', to: 'ACTIVE_UNACK' });
    expect(runVector(extra).ok).toBe(false);
  });
  it('sai thời điểm thì đỏ', () => {
    const v = structuredClone(base);
    v.expect[0].t = 3000;
    expect(runVector(v).ok).toBe(false);
  });
  it('expectView sai thì đỏ', () => {
    const v = structuredClone(base);
    v.expectView = [{ t: 2000, counts: { active: 5 } }];
    expect(runVector(v).ok).toBe(false);
  });
  it('tổng số sự kiện kỳ vọng trong bộ vector đủ lớn', () => {
    let n = 0;
    for (const g of groups) for (const c of g.cases) n += c.expect.length;
    expect(n).toBeGreaterThanOrEqual(300);
  });
});
