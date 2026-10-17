// Mục tiêu fuzz `logic-json` (T142, phần TS): logic.json đột biến qua schemas/logic.schema.json, validator checkLogic
// (@mat/project-schema, rules-logic) và engine (@mat/logic-engine, qua LogicHarness như bộ chạy vector). Kho mầm
// tests/fuzz-corpus/logic-json.json (mọi ca của tests/logic-vectors). Bất biến:
//  - schema, checkLogic, engine không ném; mã lỗi thuộc ERROR_CODES, cảnh báo W_*;
//  - tài liệu qua kiểm tra: chạy các bước ngẫu nhiên (đầu vào Tag HỮU HẠN, chất lượng ngẫu nhiên, giờ thực, khởi động
//    lại, flush, kết quả ghi): sau mỗi bước mọi Tag đầu ra, trạng thái khối, hành động và kho retain không có số NaN
//    hay ±Infinity (khi kho retain ban đầu cũng hữu hạn);
//  - checkLogic tất định (cứ 8 ca chạy lại).
import {
  firstNonFinite,
  finiteFor,
  int,
  loadCorpus,
  mutateJson,
  dictionaryOf,
  pick,
} from '../ts-lib.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ps = await import('../../../packages/project-schema/src/index.ts');
const le = await import('../../../packages/logic-engine/src/index.ts');
const { Validator } = await import('@cfworker/json-schema');

const TYPES = [
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
];
const KINDS = ['external', 'internal', 'calculated'];
const SCANS = [10, 50, 100, 250, 1000];

export async function setup() {
  const cases = loadCorpus('logic-json.json');
  const schema = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../schemas/logic.schema.json'), 'utf8'),
  );
  const validator = new Validator(schema, '7', false);
  const docs = cases.map((c) => c.doc);
  const dict = dictionaryOf(docs);
  dict.strings.push(
    'A && B',
    'LEVEL > 1e308',
    'FLOW * 1e308',
    '-FLOW',
    'N / 0',
    'abs(LEVEL)',
    'L.T',
    'CMD',
    'x.y',
  );
  return { cases, validator, docs, dict };
}

function tagMap(tags) {
  return new Map(
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
}

export function generate(ctx, r) {
  const base = pick(r, ctx.cases);
  const doc =
    r() < 0.15 ? structuredClone(base.doc) : mutateJson(base.doc, r, ctx.dict, pick(r, ctx.docs));
  const tags = structuredClone(base.tags);
  if (r() < 0.3) {
    const ids = Object.keys(tags);
    const id = pick(r, ids);
    if (id)
      tags[id] = { ...tags[id], type: pick(r, TYPES), kind: pick(r, KINDS), writable: r() < 0.5 };
  }
  const config = { ...base.config };
  if (r() < 0.3) config.scanMs = pick(r, SCANS);
  if (r() < 0.2) config.tzOffsetMin = int(r, -720, 840);
  if (r() < 0.2) config.writes = pick(r, ['on', 'off']);
  if (r() < 0.2) config.maxWritesPerMin = int(r, 0, 120);
  let retain = base.retain;
  let finiteRetain = true;
  if (retain && typeof retain === 'object' && r() < 0.4) {
    retain = { ...retain };
    const k = pick(r, Object.keys(retain));
    if (k) {
      const v = pick(r, [
        0,
        -1,
        1.5,
        1e300,
        -1e300,
        2 ** 53,
        'x',
        '9223372036854775808',
        '-1',
        true,
        null,
        1e-320,
      ]);
      retain[k] = v;
    }
  } else if (r() < 0.05) retain = 'lost';
  if (retain && typeof retain === 'object' && firstNonFinite(retain) !== null) finiteRetain = false;
  // Bước: t tăng ngặt, bội của scanMs; tổng ≤ ~3.000 lần quét
  const ids = Object.keys(tags);
  const steps = [];
  let t = 0;
  let scans = 0;
  const n = int(r, 1, 25);
  for (let i = 0; i < n; i++) {
    const step = { t };
    if (i > 0 && r() < 0.05)
      step.restart = r() < 0.7 ? true : { retain: r() < 0.5 ? 'lost' : 'flushed' };
    if (r() < 0.25)
      step.wall = new Date(
        Date.UTC(2026, int(r, 0, 11), int(r, 1, 28), int(r, 0, 23), int(r, 0, 59), int(r, 0, 59)),
      )
        .toISOString()
        .replace('.000Z', 'Z');
    if (r() < 0.1) step.timeSynced = r() < 0.7;
    const set = {};
    for (let k = int(r, 0, 4); k > 0; k--) {
      const id = pick(r, ids);
      if (!id) break;
      const q = r();
      set[id] =
        q < 0.8
          ? finiteFor(tags[id].type, r)
          : q < 0.9
            ? { value: finiteFor(tags[id].type, r), quality: 'UNCERTAIN', reason: 'CLAMPED' }
            : q < 0.95
              ? null
              : { value: null, quality: 'BAD', reason: 'DISCONNECTED' };
    }
    step.set = set;
    const rules = Array.isArray(doc?.rules) ? doc.rules : [];
    if (r() < 0.1 && rules.length)
      step.writeResult = {
        rule: String(pick(r, rules)?.id),
        result: pick(r, ['OK', 'TIMEOUT', 'REJECTED', 'x']),
      };
    if (r() < 0.15) step.flush = true;
    steps.push(step);
    const gap = r() < 0.1 ? int(r, 100, 600) : int(r, 1, 40);
    scans += gap;
    if (scans > 3000) break;
    t += gap * config.scanMs;
  }
  return { base: base.id, doc, tags, config, retain, finiteRetain, steps };
}

function parseWall(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const blockIds = (doc) =>
  ps.LOGIC_BLOCK_KINDS.flatMap((k) =>
    Array.isArray(doc[k]) ? doc[k].map((b) => b?.id) : [],
  ).filter((x) => typeof x === 'string');

/** Mọi chuỗi và khóa đều là UTF-16 hợp lệ (không surrogate lẻ). */
const wellFormedDeep = (v) => {
  if (typeof v === 'string') return v.isWellFormed();
  if (Array.isArray(v)) return v.every(wellFormedDeep);
  if (v !== null && typeof v === 'object')
    return Object.entries(v).every(([k, x]) => k.isWellFormed() && wellFormedDeep(x));
  return true;
};

/** Có số NaN/±Infinity ở đâu đó trong `v` (bigint bỏ qua). */
const nonFiniteIn = (v) =>
  JSON.stringify(v, (_k, x) =>
    typeof x === 'number' && !Number.isFinite(x)
      ? 'NONFINITE'
      : typeof x === 'bigint'
        ? x.toString()
        : x,
  ).includes('"NONFINITE"');

let n = 0;
export function check(ctx, input) {
  const problems = [];
  const counters = [];
  const { tags, config, steps } = input;
  // Như đường đọc tệp thật (validate.ts loadJson): văn bản JSON (Infinity thành null), surrogate lẻ là E_JSON.
  const text = JSON.stringify(input.doc) ?? 'null';
  const doc = JSON.parse(text);
  if (!wellFormedDeep(doc)) {
    counters.push('json-rejected');
    return { problems, counters };
  }
  if (!ctx.validator.validate(doc).valid) {
    counters.push('schema-rejected');
    return { problems, counters };
  }
  const tmap = tagMap(tags);
  const opts = { tags: tmap, scanMs: config.scanMs, bytes: Buffer.byteLength(text) };
  const res = ps.checkLogic(doc, opts);
  for (const e of res.errors)
    if (!ps.ERROR_CODES.includes(e.code)) problems.push(`mã lỗi lạ: ${e.code}`);
  for (const w of res.warnings)
    if (!/^W_[A-Z0-9_]+$/.test(w.code)) problems.push(`mã cảnh báo lạ: ${w.code}`);
  if (n++ % 8 === 0) {
    const again = ps.checkLogic(doc, opts);
    const codes = (x) =>
      JSON.stringify([
        x.errors.map((e) => e.code + e.path),
        x.warnings.map((e) => e.code + e.path),
      ]);
    if (codes(again) !== codes(res)) problems.push('checkLogic không tất định');
  }
  if (res.errors.length > 0) {
    counters.push('rules-rejected', 'code:' + res.errors[0].code);
    return { problems, counters };
  }
  counters.push('accepted');
  const h = new le.LogicHarness(doc, {
    tags: tmap,
    config: {
      scanMs: config.scanMs,
      tzOffsetMin: config.tzOffsetMin,
      writes: config.writes,
      maxWritesPerMin: config.maxWritesPerMin,
    },
    ...(input.retain !== undefined ? { retain: input.retain } : {}),
  });
  const outputs = ps.logicOutputs(doc);
  const ids = blockIds(doc);
  let wall = null;
  let wallAt = 0;
  let synced = true;
  const big = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
  for (const s of steps) {
    let actions;
    if (s.restart) {
      h.restart({ ...(s.restart === true ? {} : s.restart), at: s.t });
      actions = [];
    } else actions = h.runBefore(s.t);
    if (s.wall !== undefined) {
      wall = parseWall(s.wall);
      wallAt = s.t;
    }
    if (s.timeSynced !== undefined) synced = s.timeSynced;
    h.setWall(wall, synced, wallAt);
    for (const [id, v] of Object.entries(s.set ?? {})) h.set(id, v);
    if (s.writeResult) h.writeResult(s.writeResult.rule, s.writeResult.result);
    actions.push(...h.runTo(s.t));
    if (s.flush) h.flush();
    if (!input.finiteRetain) continue;
    const where = `t=${s.t}`;
    if (nonFiniteIn(actions))
      problems.push(
        `${where} hành động có số không hữu hạn: ${JSON.stringify(actions, big).slice(0, 300)}`,
      );
    for (const o of outputs) {
      const v = h.output(o.tag);
      if (v && typeof v.value === 'number' && !Number.isFinite(v.value))
        problems.push(`${where} đầu ra ${o.tag} (${o.block}.${o.field}) = ${v.value}`);
    }
    for (const id of ids) {
      const st = h.engine.state(id);
      if (st && nonFiniteIn(st))
        problems.push(
          `${where} trạng thái ${id} có số không hữu hạn: ${JSON.stringify(st, big).slice(0, 300)}`,
        );
    }
    const snap = h.retainSnapshot();
    if (nonFiniteIn(snap))
      problems.push(
        `${where} retain có số không hữu hạn: ${JSON.stringify(snap, big).slice(0, 300)}`,
      );
    if (problems.length) break;
  }
  counters.push('ran');
  return { problems, counters };
}
