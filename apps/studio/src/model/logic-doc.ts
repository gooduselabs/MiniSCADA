// Mô hình logic.json trong Studio (feature 011, T143; FR-094; contracts/logic-engine.md §1, §9, §11): hàm thuần, không DOM.
// Mọi thao tác trả tài liệu MỚI (không sửa tài liệu cũ) để editor gửi một sửa đổi `logicSet` cho mỗi lần sửa (một bước hoàn
// tác). Bảy nhóm theo thứ tự cây (Luật, Timer, Counter, Cộng dồn, Giờ chạy, Lịch, Ghi PLC); id mọi nhóm chung một không gian.
// Kiểm khi gõ dùng đúng validator TS của @mat/project-schema (`checkLogic`, cùng vector với C++), không viết luật riêng.
import type { TagDataType } from '@mat/expression';
import {
  LOGIC_DEFAULTS,
  LOGIC_LIMITS,
  checkLogic,
  logicOutputs,
  logicTagsFromList,
  renameInExpression,
  type Issue,
  type LogicAction,
  type LogicDoc,
  type LogicOutput,
  type TagV1,
} from '@mat/project-schema';
import type { AssistContext } from './expression-assist.ts';

export type LogicKind =
  'rule' | 'timer' | 'counter' | 'totalizer' | 'runhours' | 'schedule' | 'writes';
export const LOGIC_KINDS: readonly LogicKind[] = [
  'rule',
  'timer',
  'counter',
  'totalizer',
  'runhours',
  'schedule',
  'writes',
];

type DocKey = 'rules' | 'timers' | 'counters' | 'totalizers' | 'runhours' | 'schedules' | 'writes';
export const KIND_KEY: Readonly<Record<LogicKind, DocKey>> = {
  rule: 'rules',
  timer: 'timers',
  counter: 'counters',
  totalizer: 'totalizers',
  runhours: 'runhours',
  schedule: 'schedules',
  writes: 'writes',
};
const KEY_KIND = Object.fromEntries(
  Object.entries(KIND_KEY).map(([k, v]) => [v, k as LogicKind]),
) as Record<DocKey, LogicKind>;

/** Giới hạn số mục mỗi nhóm (E_LOGIC_LIMIT). */
export const KIND_LIMIT: Readonly<Record<LogicKind, number>> = {
  rule: LOGIC_LIMITS.rules,
  timer: LOGIC_LIMITS.timers,
  counter: LOGIC_LIMITS.counters,
  totalizer: LOGIC_LIMITS.totalizers,
  runhours: LOGIC_LIMITS.runhours,
  schedule: LOGIC_LIMITS.schedules,
  writes: LOGIC_LIMITS.writes,
};

const PREFIX: Readonly<Record<LogicKind, string>> = {
  rule: 'rule_',
  timer: 't_',
  counter: 'c_',
  totalizer: 'z_',
  runhours: 'h_',
  schedule: 's_',
  writes: 'w_',
};

/** Trường đầu ra theo nhóm và hậu tố Tag mặc định (`LOGIC.<ID>.<hậu tố>`). */
const OUT_SUFFIX: Readonly<Partial<Record<LogicKind, Readonly<Record<string, string>>>>> = {
  timer: { q: 'Q', et: 'ET' },
  counter: { value: 'VALUE', reached: 'REACHED' },
  totalizer: { total: 'TOTAL', gapSeconds: 'GAP_S' },
  runhours: { hours: 'HOURS', starts: 'STARTS', due: 'DUE' },
  schedule: { out: 'Q' },
};
/** Trường đầu ra (Tag logic) của nhóm (feature 015: nhân bản khối đặt đầu ra theo id mới). */
export const outputFields = (kind: LogicKind): string[] => Object.keys(OUT_SUFFIX[kind] ?? {});

const EXPR_FIELDS: Readonly<Partial<Record<LogicKind, readonly string[]>>> = {
  rule: ['when'],
  timer: ['in'],
  counter: ['up', 'down', 'reset'],
  totalizer: ['source', 'reset'],
  runhours: ['run', 'reset'],
};

export const ID_RE = /^[a-z][a-z0-9_]{0,47}$/;

export type Block = Record<string, unknown> & { id: string };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function emptyLogic(): LogicDoc {
  return { schemaVersion: '1.0.0' };
}

/** Mục của một nhóm (bản đọc; không sửa trực tiếp). */
export function blocksOf(doc: LogicDoc | null | undefined, kind: LogicKind): Block[] {
  const list = doc?.[KIND_KEY[kind]] as unknown;
  return Array.isArray(list)
    ? (list as unknown[]).filter((b): b is Block => typeof b === 'object' && b !== null)
    : [];
}

export function findBlock(doc: LogicDoc | null | undefined, kind: LogicKind, id: string) {
  return blocksOf(doc, kind).find((b) => b.id === id) ?? null;
}

/** Mọi id (writes và khối). */
export function allIds(doc: LogicDoc | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const k of LOGIC_KINDS) for (const b of blocksOf(doc, k)) out.add(b.id);
  return out;
}

export function kindOfId(doc: LogicDoc | null | undefined, id: string): LogicKind | null {
  for (const k of LOGIC_KINDS) if (blocksOf(doc, k).some((b) => b.id === id)) return k;
  return null;
}

export function blockCounts(doc: LogicDoc | null | undefined): Record<LogicKind, number> {
  const out = {} as Record<LogicKind, number>;
  for (const k of LOGIC_KINDS) out[k] = blocksOf(doc, k).length;
  return out;
}

/** Id gợi ý chưa dùng: `rule_1`, `t_2`… */
export function suggestId(doc: LogicDoc | null | undefined, kind: LogicKind): string {
  const used = allIds(doc);
  for (let n = 1; ; n++) {
    const id = `${PREFIX[kind]}${n}`;
    if (!used.has(id)) return id;
  }
}

const outTag = (id: string, suffix: string) => `LOGIC.${id.toUpperCase()}.${suffix}`;

/** Khối mới với tham số mặc định (đầu ra theo mẫu `LOGIC.<ID>.*`). */
export function defaultBlock(kind: LogicKind, id: string): Block {
  const o = (f: string) => outTag(id, OUT_SUFFIX[kind]![f]!);
  switch (kind) {
    case 'rule':
      return { id, name: '', enabled: true, when: '', hold: 1000, onRise: [], onFall: [] };
    case 'timer':
      return { id, kind: 'ton', in: '', pt: 1000, q: o('q'), et: o('et') };
    case 'counter':
      return {
        id,
        up: '',
        down: null,
        reset: null,
        preset: null,
        value: o('value'),
        reached: o('reached'),
        retain: true,
      };
    case 'totalizer':
      return {
        id,
        source: '',
        rateUnit: 'h',
        factor: 1,
        cutoff: 0,
        maxGapMs: 5000,
        reset: null,
        total: o('total'),
        gapSeconds: o('gapSeconds'),
        retain: true,
      };
    case 'runhours':
      return {
        id,
        run: '',
        reset: null,
        serviceEveryHours: null,
        hours: o('hours'),
        starts: o('starts'),
        due: o('due'),
        retain: true,
      };
    case 'schedule':
      return {
        id,
        weekly: [{ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }],
        exceptions: [],
        out: o('out'),
      };
    case 'writes':
      return {
        id,
        tag: '',
        allowed: { values: [true, false] },
        minIntervalMs: 30000,
        maxPerHour: 20,
      };
  }
}

function withList(doc: LogicDoc, kind: LogicKind, list: Block[]): LogicDoc {
  const next = clone(doc) as unknown as Record<string, unknown>;
  next[KIND_KEY[kind]] = list;
  return next as unknown as LogicDoc;
}

export function addBlock(
  doc: LogicDoc,
  kind: LogicKind,
  opts: { id?: string; after?: string } = {},
): { doc: LogicDoc; id: string } {
  const id = opts.id ?? suggestId(doc, kind);
  const list = clone(blocksOf(doc, kind));
  const at = opts.after ? list.findIndex((b) => b.id === opts.after) : -1;
  const block = defaultBlock(kind, id);
  if (at >= 0) list.splice(at + 1, 0, block);
  else list.push(block);
  return { doc: withList(doc, kind, list), id };
}

/** Gán trường (`undefined` thì bỏ khóa). */
export function updateBlock(
  doc: LogicDoc,
  kind: LogicKind,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): LogicDoc {
  const list = clone(blocksOf(doc, kind));
  const b = list.find((x) => x.id === id);
  if (!b) return doc;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id') continue;
    if (v === undefined) delete b[k];
    else b[k] = clone(v);
  }
  return withList(doc, kind, list);
}

export function removeBlock(doc: LogicDoc, kind: LogicKind, id: string): LogicDoc {
  const list = blocksOf(doc, kind);
  if (!list.some((b) => b.id === id)) return doc;
  return withList(
    doc,
    kind,
    clone(list).filter((b) => b.id !== id),
  );
}

/** Chuyển một khối lên (−1) hoặc xuống (+1) trong nhóm. */
export function moveBlock(doc: LogicDoc, kind: LogicKind, id: string, delta: -1 | 1): LogicDoc {
  const list = clone(blocksOf(doc, kind));
  const i = list.findIndex((b) => b.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return doc;
  const [b] = list.splice(i, 1);
  list.splice(j, 0, b!);
  return withList(doc, kind, list);
}

export type RenameResult =
  | { ok: true; doc: LogicDoc; tags: Record<string, string> }
  | { ok: false; reason: 'format' | 'duplicate' | 'missing' };

/**
 * Đổi id một khối (F2): hành động write/pulse trỏ tới mục writes đổi theo; Tag đầu ra theo mẫu mặc định
 * `LOGIC.<ID cũ>.<hậu tố>` đổi sang id mới và mọi biểu thức trong logic.json đọc chúng đổi theo (`tags`: cũ → mới). Đầu ra
 * do người dùng tự đặt tên giữ nguyên.
 */
export function renameBlock(doc: LogicDoc, from: string, to: string): RenameResult {
  const kind = kindOfId(doc, from);
  if (!kind) return { ok: false, reason: 'missing' };
  if (from === to) return { ok: true, doc, tags: {} };
  if (!ID_RE.test(to)) return { ok: false, reason: 'format' };
  if (allIds(doc).has(to)) return { ok: false, reason: 'duplicate' };
  const next = clone(doc);
  const list = blocksOf(next, kind);
  const b = list.find((x) => x.id === from)!;
  b.id = to;
  const tags: Record<string, string> = {};
  for (const [field, suffix] of Object.entries(OUT_SUFFIX[kind] ?? {}))
    if (b[field] === outTag(from, suffix)) {
      const nt = outTag(to, suffix);
      tags[b[field] as string] = nt;
      b[field] = nt;
    }
  if (kind === 'writes')
    for (const r of next.rules ?? [])
      for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])])
        if (a.write === from) a.write = to;
  if (Object.keys(tags).length) {
    const rename = (src: unknown): unknown => {
      if (typeof src !== 'string') return src;
      let s = src;
      for (const [o, n] of Object.entries(tags)) s = renameInExpression(s, o, n) ?? s;
      return s;
    };
    for (const k of LOGIC_KINDS)
      for (const blk of blocksOf(next, k)) {
        for (const f of EXPR_FIELDS[k] ?? []) if (f in blk) blk[f] = rename(blk[f]);
        if (k === 'rule')
          for (const a of [
            ...((blk.onRise as LogicAction[] | undefined) ?? []),
            ...((blk.onFall as LogicAction[] | undefined) ?? []),
          ]) {
            if (a.value && typeof a.value === 'object')
              a.value = { expr: rename(a.value.expr) as string };
            if (typeof a.tag === 'string' && tags[a.tag]) a.tag = tags[a.tag];
          }
      }
  }
  return { ok: true, doc: next, tags };
}

// ---------- Hành động của luật ----------

export type Edge = 'onRise' | 'onFall';
const ACTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  setTag: ['do', 'tag', 'value'],
  toggle: ['do', 'tag'],
  write: ['do', 'write', 'value'],
  pulse: ['do', 'write', 'value', 'ms'],
};

function withActions(
  doc: LogicDoc,
  ruleId: string,
  edge: Edge,
  fn: (list: LogicAction[]) => LogicAction[],
): LogicDoc {
  const list = clone(blocksOf(doc, 'rule'));
  const r = list.find((x) => x.id === ruleId);
  if (!r) return doc;
  r[edge] = fn(clone((r[edge] as LogicAction[] | undefined) ?? []));
  return withList(doc, 'rule', list);
}

export function addAction(
  doc: LogicDoc,
  ruleId: string,
  edge: Edge,
  action: LogicAction,
): LogicDoc {
  return withActions(doc, ruleId, edge, (l) => [...l, clone(action)]);
}

/** Sửa một hành động; đổi `do` thì bỏ các khóa không thuộc loại mới (giữ `value` nếu có). */
export function updateAction(
  doc: LogicDoc,
  ruleId: string,
  edge: Edge,
  index: number,
  patch: Readonly<Record<string, unknown>>,
): LogicDoc {
  return withActions(doc, ruleId, edge, (l) => {
    const a = l[index] as unknown as Record<string, unknown> | undefined;
    if (!a) return l;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete a[k];
      else a[k] = clone(v);
    }
    const keys = ACTION_KEYS[String(a.do)];
    if (keys) for (const k of Object.keys(a)) if (!keys.includes(k)) delete a[k];
    return l;
  });
}

export function removeAction(doc: LogicDoc, ruleId: string, edge: Edge, index: number): LogicDoc {
  return withActions(doc, ruleId, edge, (l) => l.filter((_, i) => i !== index));
}

/** Mục writes → luật dùng nó (theo thứ tự luật). */
export function writesUsage(doc: LogicDoc | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of blocksOf(doc, 'writes')) out.set(w.id, []);
  for (const r of doc?.rules ?? [])
    for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])])
      if (typeof a.write === 'string') {
        const list = out.get(a.write);
        if (list && !list.includes(r.id)) list.push(r.id);
      }
  return out;
}

// ---------- Kiểm ----------

export interface LogicCheckContext {
  tags: readonly TagV1[];
  tables?: readonly string[];
  scanMs?: number;
  flushS?: number;
  /** Trạng thái ghi PLC của thiết bị đích khi Online (W_LOGIC_WRITES_OFF). */
  deviceWrites?: 'on' | 'off';
}

/** Validator TS của logic.json (cùng luật với C++): kiểm ngay sau mỗi lần sửa. */
export function checkLogicDoc(
  doc: LogicDoc,
  ctx: LogicCheckContext,
): { errors: Issue[]; warnings: Issue[] } {
  const tables = new Set(ctx.tables ?? []);
  return checkLogic(doc, {
    tags: logicTagsFromList(ctx.tags),
    hasTable: (n) => tables.has(n),
    scanMs: ctx.scanMs ?? LOGIC_DEFAULTS.scanMs,
    flushS: ctx.flushS ?? LOGIC_DEFAULTS.flushS,
    ...(ctx.deviceWrites ? { deviceWrites: ctx.deviceWrites } : {}),
  });
}

export interface IssueTarget {
  kind: LogicKind;
  id: string | null;
  field: string | null;
  index?: number;
}

/** Đường dẫn JSON Pointer của lỗi (`/rules/1/when`) → nhóm, id khối, ô (chỉ số hành động, khung lịch). */
export function issueTarget(doc: LogicDoc | null | undefined, path: string): IssueTarget | null {
  const parts = path.split('/').filter(Boolean);
  const kind = KEY_KIND[parts[0] as DocKey];
  if (!kind) return null;
  if (parts.length < 2) return { kind, id: null, field: null };
  const b = blocksOf(doc, kind)[Number(parts[1])];
  const id = b?.id ?? null;
  const field = parts[2] ?? null;
  const index = parts[3] !== undefined && /^\d+$/.test(parts[3]) ? Number(parts[3]) : undefined;
  return index !== undefined && field !== null ? { kind, id, field, index } : { kind, id, field };
}

/** Tag logic (đầu ra hợp lệ, không trùng) cho gợi ý biểu thức. */
export function outputTagsOf(doc: LogicDoc | null | undefined): LogicOutput[] {
  if (!doc) return [];
  const seen = new Set<string>();
  return logicOutputs(doc).filter((o) => (seen.has(o.tag) ? false : (seen.add(o.tag), true)));
}

/** Ngữ cảnh gợi ý và kiểm của ô biểu thức: Tag của project cộng Tag logic. */
export function logicAssist(
  tags: readonly TagV1[],
  doc: LogicDoc | null | undefined,
  target: TagDataType,
  tables: readonly string[] = [],
): AssistContext {
  const list = tags.map((t) => ({ id: t.id, type: t.type }));
  const have = new Set(list.map((t) => t.id));
  for (const o of outputTagsOf(doc)) if (!have.has(o.tag)) list.push({ id: o.tag, type: o.type });
  return { tags: list, tables, target };
}

/**
 * Ước tính ghi đĩa của retain mỗi ngày (contract §9), cùng công thức với validator (W_LOGIC_RETAIN_IO): mỗi luật (mã cạnh)
 * và mỗi khối retain 24 B, cộng 512 B và 4 KiB mỗi lần ghi tệp, 86400/flushS lần mỗi ngày. 0 khi không có gì để lưu.
 */
export function retainBytesPerDay(doc: LogicDoc | null | undefined, flushS: number): number {
  const n =
    (doc?.rules ?? []).length +
    (doc?.counters ?? []).filter((c) => c.retain !== false).length +
    (doc?.totalizers ?? []).filter((z) => z.retain !== false).length +
    (doc?.runhours ?? []).filter((h) => h.retain !== false).length;
  if (n === 0) return 0;
  return (n * 24 + 512 + 4096) * Math.floor(86400 / flushS);
}

export const isExprValue = (v: unknown): v is { expr: string } =>
  typeof v === 'object' && v !== null && typeof (v as { expr?: unknown }).expr === 'string';
