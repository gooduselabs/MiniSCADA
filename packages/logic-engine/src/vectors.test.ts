// Bộ vector chung TS ↔ C++ (tests/logic-vectors, T125; SC-024, FR-092, FR-093): mỗi ca kiểm tập mã lỗi (và cảnh báo
// nếu ca nêu) của validator TS, rồi chạy `steps` bằng đồng hồ giả và so từng `expect`. Ngữ nghĩa bộ chạy ở
// tests/logic-vectors/README.md; bản C++ (core/logic/tests/vectors_test.cpp, T134) chạy giống hệt.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLogic, type LogicDoc, type LogicTagInfo } from '@mat/project-schema';
import type { TagDataType } from '@mat/expression';
import { LogicHarness } from './harness.ts';
import type { ActionOut, RetainStore } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/logic-vectors');

interface VTag {
  type: TagDataType;
  kind?: LogicTagInfo['kind'];
  writable?: boolean;
  expression?: string;
}
type VSet =
  | boolean
  | number
  | string
  | null
  | {
      value: boolean | number | string | null;
      quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
      reason?: string;
    };
interface VExpect {
  actions?: Array<Record<string, unknown>>;
  outputs?: Record<string, unknown>;
  state?: Record<string, string | Record<string, unknown>>;
  retain?: RetainStore;
  retainLost?: boolean;
}
interface VStep {
  t: number;
  restart?: true | { doc?: LogicDoc; retain?: 'flushed' | 'lost' | RetainStore };
  set?: Record<string, VSet>;
  wall?: string;
  timeSynced?: boolean;
  writeResult?: { rule: string; result: string };
  flush?: true;
  expect?: VExpect;
}
interface VCase {
  id: string;
  group: string;
  description: string;
  doc: LogicDoc;
  tags: Record<string, VTag>;
  config: {
    scanMs: number;
    tzOffsetMin: number;
    writes: 'on' | 'off';
    maxWritesPerMin: number;
    flushS?: number;
    deviceWrites?: 'on' | 'off';
  };
  retain?: RetainStore | 'lost';
  steps: VStep[];
  expectErrors: string[];
  expectWarnings?: string[];
}

const MIN: Record<string, number> = {
  rules: 40,
  timers: 30,
  counters: 25,
  totalizers: 25,
  runhours: 15,
  schedules: 40,
  writes: 15,
  static: 30,
  retain: 10,
};

const groups = new Map<string, VCase[]>();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { group: string; cases: VCase[] };
  groups.set(j.group, j.cases);
}

/** Giờ ISO 8601 `YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)` → ms UTC (bộ phân tích tối giản, như bản C++). */
function parseWall(s: string): number {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      s,
    );
  if (!m) throw new Error(`wall sai dạng: ${s}`);
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    ms,
  );
  const off = m[8] === 'Z' ? 0 : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
  return utc - off * 60000;
}

const tagMap = (tags: Record<string, VTag>) =>
  new Map<string, LogicTagInfo>(
    Object.entries(tags).map(([id, t]) => [
      id,
      {
        type: t.type,
        kind: t.kind ?? 'external',
        access: t.writable ? 'RW' : 'R',
        ...(t.expression !== undefined ? { expression: t.expression } : {}),
      },
    ]),
  );

/** So giá trị: số nguyên lớn (INT64) viết bằng chuỗi thập phân hoặc số; số thực so từng bit. */
function same(actual: unknown, want: unknown): boolean {
  if (typeof actual === 'bigint') {
    if (typeof want === 'string' || typeof want === 'number') return actual === BigInt(want);
    return false;
  }
  if (typeof actual === 'number' && typeof want === 'number')
    return Object.is(actual, want) || actual === want;
  return actual === want;
}

function partial(
  actual: Record<string, unknown> | undefined,
  want: Record<string, unknown>,
  where: string,
): string[] {
  const errs: string[] = [];
  for (const [k, v] of Object.entries(want))
    if (!same(actual?.[k], v))
      errs.push(`${where}.${k}: có ${String(actual?.[k])}, cần ${String(v)}`);
  return errs;
}

function runCase(c: VCase): string[] {
  const tags = tagMap(c.tags);
  const errs: string[] = [];
  const check = checkLogic(c.doc, {
    tags,
    scanMs: c.config.scanMs,
    ...(c.config.flushS !== undefined ? { flushS: c.config.flushS } : {}),
    ...(c.config.deviceWrites !== undefined ? { deviceWrites: c.config.deviceWrites } : {}),
  });
  const codes = [...new Set(check.errors.map((e) => e.code))].sort();
  const want = [...new Set(c.expectErrors)].sort();
  if (JSON.stringify(codes) !== JSON.stringify(want))
    errs.push(
      `expectErrors: có ${JSON.stringify(check.errors.map((e) => `${e.code} ${e.path} ${e.message}`))}, cần ${JSON.stringify(want)}`,
    );
  if (c.expectWarnings !== undefined) {
    const w = [...new Set(check.warnings.map((e) => e.code))].sort();
    const ww = [...new Set(c.expectWarnings)].sort();
    if (JSON.stringify(w) !== JSON.stringify(ww))
      errs.push(`expectWarnings: có ${JSON.stringify(w)}, cần ${JSON.stringify(ww)}`);
  }
  if (errs.length > 0 || c.expectErrors.length > 0 || c.steps.length === 0) return errs;

  const h = new LogicHarness(c.doc, {
    tags,
    config: {
      scanMs: c.config.scanMs,
      tzOffsetMin: c.config.tzOffsetMin,
      writes: c.config.writes,
      maxWritesPerMin: c.config.maxWritesPerMin,
    },
    ...(c.retain !== undefined ? { retain: c.retain } : {}),
  });
  let pending: ActionOut[] = [];
  let synced = true;
  let wall: number | null = null;
  let wallAt = 0;
  for (const s of c.steps) {
    const where = `t=${s.t}`;
    if (s.restart) {
      const r = s.restart === true ? {} : s.restart;
      h.restart({ ...r, at: s.t });
    } else pending.push(...h.runBefore(s.t));
    if (s.wall !== undefined) {
      wall = parseWall(s.wall);
      wallAt = s.t;
    }
    if (s.timeSynced !== undefined) synced = s.timeSynced;
    h.setWall(wall, synced, wallAt);
    for (const [id, v] of Object.entries(s.set ?? {})) h.set(id, v);
    if (s.writeResult) h.writeResult(s.writeResult.rule, s.writeResult.result);
    pending.push(...h.runTo(s.t));
    if (s.flush) h.flush();
    const e = s.expect;
    if (!e) continue;
    if (e.actions) {
      if (pending.length !== e.actions.length)
        errs.push(
          `${where} actions: có ${pending.length} ${JSON.stringify(pending, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}, cần ${e.actions.length}`,
        );
      else
        e.actions.forEach((a, i) =>
          errs.push(
            ...partial(
              pending[i] as unknown as Record<string, unknown>,
              a,
              `${where} actions[${i}]`,
            ),
          ),
        );
      pending = [];
    }
    for (const [tag, w] of Object.entries(e.outputs ?? {})) {
      const o = h.output(tag);
      if (w !== null && typeof w === 'object') {
        const got = o ?? { value: h.value(tag), quality: 'GOOD' };
        errs.push(
          ...partial(
            got as unknown as Record<string, unknown>,
            w as Record<string, unknown>,
            `${where} ${tag}`,
          ),
        );
      } else if (o !== undefined) {
        if (o.quality !== 'GOOD' || !same(o.value, w))
          errs.push(`${where} ${tag}: có ${String(o.value)} ${o.quality}, cần ${String(w)}`);
      } else if (!same(h.value(tag), w))
        errs.push(`${where} ${tag}: có ${String(h.value(tag))}, cần ${String(w)}`);
    }
    for (const [id, w] of Object.entries(e.state ?? {})) {
      const st = h.state(id) as unknown as Record<string, unknown>;
      errs.push(...partial(st, typeof w === 'string' ? { state: w } : w, `${where} state.${id}`));
    }
    if (e.retain) {
      const snap = h.retainSnapshot();
      const keys = (o: object) => Object.keys(o).sort().join(',');
      if (keys(snap) !== keys(e.retain))
        errs.push(`${where} retain: khóa ${keys(snap)}, cần ${keys(e.retain)}`);
      else errs.push(...partial(snap, e.retain, `${where} retain`));
    }
    if (e.retainLost !== undefined && h.engine.retainLost !== e.retainLost)
      errs.push(`${where} retainLost: có ${h.engine.retainLost}`);
  }
  return errs;
}

describe('tests/logic-vectors', () => {
  it('≥ 200 ca, đủ phân bố tối thiểu của contract §12, id duy nhất', () => {
    let total = 0;
    const ids = new Set<string>();
    for (const [g, min] of Object.entries(MIN)) {
      const cases = groups.get(g) ?? [];
      expect(cases.length, g).toBeGreaterThanOrEqual(min);
      total += cases.length;
      for (const c of cases) {
        expect(ids.has(c.id), c.id).toBe(false);
        ids.add(c.id);
      }
    }
    expect(total).toBeGreaterThanOrEqual(200);
  });

  it('nhóm static: mỗi mã E_LOGIC_* có ít nhất một ca sai; mọi mã W_LOGIC_* có ca', () => {
    const all = [...groups.values()].flat();
    const errCodes = new Set(all.flatMap((c) => c.expectErrors));
    const warnCodes = new Set(all.flatMap((c) => c.expectWarnings ?? []));
    for (const code of [
      'E_LOGIC_LIMIT',
      'E_LOGIC_ID',
      'E_LOGIC_TAG_REF',
      'E_LOGIC_TYPE',
      'E_LOGIC_EXPR',
      'E_LOGIC_TAG_COLLISION',
      'E_LOGIC_CYCLE',
      'E_LOGIC_SELF_TRIGGER',
      'E_LOGIC_WRITE_UNDECLARED',
      'E_LOGIC_WRITE_TARGET',
      'E_LOGIC_WRITE_VALUE',
      'E_LOGIC_ACTION',
      'E_LOGIC_TIMER',
      'E_LOGIC_COUNTER',
      'E_LOGIC_TOTALIZER',
      'E_LOGIC_SCHEDULE',
      'E_LOGIC_VERSION',
    ])
      expect(errCodes.has(code), code).toBe(true);
    for (const code of [
      'W_LOGIC_PT_ROUNDED',
      'W_LOGIC_WRITE_CONFLICT',
      'W_LOGIC_RETAIN_IO',
      'W_LOGIC_WRITES_OFF',
      'W_LOGIC_NO_HOLD',
      'W_LOGIC_DISABLED',
    ])
      expect(warnCodes.has(code), code).toBe(true);
  });

  for (const [g, cases] of groups)
    describe(g, () => {
      for (const c of cases) it(c.id, () => expect(runCase(c)).toEqual([]));
    });
});
