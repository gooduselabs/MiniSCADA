// Thẻ luật dạng câu của editor Logic (feature 043, "Logic dễ hiểu"): đọc logic.json thành thẻ (Khi giá trị… / Theo giờ /
// Lặp lại / Timer / Đếm) và ghi thẻ ngược về logic.json. KHÔNG đổi định dạng logic.json hay engine: thẻ chỉ là cách nhìn
// khác của các khối có sẵn (rule, schedule, timer, counter, writes). Luật không đọc được thành câu (biểu thức phức tạp, hành
// động lạ) là "Luật nâng cao". Ghi lại một thẻ chưa sửa trả đúng tài liệu cũ (round-trip không mất dữ liệu): mỗi phần
// của thẻ nhớ nguồn (`src`) và chỉ viết lại phần đã đổi nghĩa. Hàm thuần, không DOM, trả tài liệu MỚI.
import { parseExpression, type ExprNode } from '@mat/expression';
import type { LogicAction, LogicDoc, TagV1 } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import { blocksOf, suggestId, type Block, type LogicKind } from './logic-doc.ts';

export type CmpOp = '==' | '!=' | '>' | '>=' | '<' | '<=';
export const CMP_OPS: readonly CmpOp[] = ['==', '!=', '>', '>=', '<', '<='];
export type Scalar = boolean | number | string;

export type Rhs = { kind: 'const'; v: Scalar } | { kind: 'tag'; tag: string };
export type Clause =
  | { tag: string; test: 'on' }
  | { tag: string; test: 'off' }
  | { tag: string; test: 'cmp'; op: CmpOp; rhs: Rhs };

export interface ValueTrigger {
  type: 'value';
  join: 'and' | 'or';
  clauses: Clause[];
  holdMs: number;
}
export interface TimeTrigger {
  type: 'time';
  /** Id khối Lịch (rỗng: tạo mới khi ghi). */
  schedule: string;
  days: number[];
  from: string;
  to: string;
  /** "Vào lúc": khung một phút (to = from + 1'). */
  at: boolean;
}
export interface EveryTrigger {
  type: 'every';
  everyMs: number;
}
export interface AdvancedTrigger {
  type: 'advanced';
  when: string;
}
export type Trigger = ValueTrigger | TimeTrigger | EveryTrigger | AdvancedTrigger;

export type Verb = 'set' | 'on' | 'off' | 'toggle' | 'pulse' | 'add' | 'expr';
export const VERBS: readonly Verb[] = ['on', 'off', 'set', 'toggle', 'pulse', 'add', 'expr'];

export interface CardAction {
  verb: Verb;
  tag: string;
  value?: Scalar;
  expr?: string;
  ms?: number;
  /** Mục writes đang dùng (Tag thiết bị). */
  write?: string;
  /** Hành động gốc trong logic.json (giữ nguyên khi thẻ không đổi nghĩa). */
  src?: LogicAction;
}

export interface RuleCard {
  kind: 'rule';
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  /** null: có hành động không đọc được thành câu (giữ nguyên, sửa ở Nâng cao). */
  rise: CardAction[] | null;
  fall: CardAction[] | null;
  /** Biểu thức gốc `when` (giữ nguyên khi điều kiện không đổi nghĩa). */
  srcWhen: string;
}
export interface TimerCard {
  kind: 'timer';
  id: string;
  timerKind: 'ton' | 'tof' | 'tp' | string;
  input: Trigger;
  pt: number;
  q: string;
  srcIn: string;
}
export interface CounterCard {
  kind: 'counter';
  id: string;
  up: Trigger;
  reset: Trigger | null;
  preset: number | null;
  value: string;
  reached: string;
  srcUp: string;
  srcReset: string | null;
}
export interface OtherCard {
  kind: 'other';
  blockKind: LogicKind;
  id: string;
}
export type Card = RuleCard | TimerCard | CounterCard | OtherCard;

/** Loại kích hoạt để tô màu, icon và lọc. */
export type CardCategory = 'value' | 'time' | 'every' | 'timer' | 'counter' | 'advanced' | 'other';
export function cardCategory(c: Card): CardCategory {
  if (c.kind === 'rule') {
    if (c.trigger.type === 'advanced' || c.rise === null || c.fall === null) return 'advanced';
    return c.trigger.type;
  }
  if (c.kind === 'timer') return 'timer';
  if (c.kind === 'counter') return 'counter';
  return 'other';
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Điều kiện: biểu thức ⇄ câu ----------

const unparen = (n: ExprNode): ExprNode => (n.t === 'paren' ? unparen(n.x) : n);

function constOf(n: ExprNode): Scalar | undefined {
  n = unparen(n);
  if (n.t === 'num' || n.t === 'bool' || n.t === 'str') return n.v;
  if (n.t === 'un' && n.op === '-') {
    const x = unparen(n.x);
    if (x.t === 'num') return -x.v;
  }
  return undefined;
}

const MIRROR: Record<CmpOp, CmpOp> = {
  '==': '==',
  '!=': '!=',
  '>': '<',
  '>=': '<=',
  '<': '>',
  '<=': '>=',
};

function clauseOf(n: ExprNode): Clause | null {
  n = unparen(n);
  if (n.t === 'tag') return { tag: n.id, test: 'on' };
  if (n.t === 'un' && n.op === '!') {
    const x = unparen(n.x);
    return x.t === 'tag' ? { tag: x.id, test: 'off' } : null;
  }
  if (n.t === 'bin' && (CMP_OPS as readonly string[]).includes(n.op)) {
    const op = n.op as CmpOp;
    const l = unparen(n.l);
    const r = unparen(n.r);
    if (l.t === 'tag') {
      if (r.t === 'tag') return { tag: l.id, test: 'cmp', op, rhs: { kind: 'tag', tag: r.id } };
      const v = constOf(r);
      if (v !== undefined) return { tag: l.id, test: 'cmp', op, rhs: { kind: 'const', v } };
    } else if (r.t === 'tag') {
      const v = constOf(l);
      if (v !== undefined)
        return { tag: r.id, test: 'cmp', op: MIRROR[op], rhs: { kind: 'const', v } };
    }
  }
  return null;
}

function flatten(n: ExprNode, op: '&&' | '||', out: ExprNode[]): void {
  n = unparen(n);
  if (n.t === 'bin' && n.op === op) {
    flatten(n.l, op, out);
    flatten(n.r, op, out);
  } else out.push(n);
}

/** Đọc một biểu thức điều kiện thành mệnh đề (null: không phải dạng câu). Chuỗi rỗng: chưa có mệnh đề. */
export function parseCondition(src: string): { join: 'and' | 'or'; clauses: Clause[] } | null {
  if (src.trim() === '') return { join: 'and', clauses: [] };
  const p = parseExpression(src);
  if ('error' in p) return null;
  const root = unparen(p.root);
  for (const [op, join] of [
    ['&&', 'and'],
    ['||', 'or'],
  ] as const) {
    if (root.t === 'bin' && root.op === op) {
      const parts: ExprNode[] = [];
      flatten(root, op, parts);
      const clauses = parts.map(clauseOf);
      if (clauses.some((c) => c === null)) return null;
      return { join, clauses: clauses as Clause[] };
    }
  }
  const c = clauseOf(root);
  return c ? { join: 'and', clauses: [c] } : null;
}

export function formatScalar(v: Scalar): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function formatClause(c: Clause): string {
  if (c.test === 'on') return c.tag;
  if (c.test === 'off') return `!${c.tag}`;
  const r = c.rhs.kind === 'tag' ? c.rhs.tag : formatScalar(c.rhs.v);
  return `${c.tag} ${c.op} ${r}`;
}

const clauseComplete = (c: Clause) =>
  c.tag !== '' && (c.test !== 'cmp' || c.rhs.kind !== 'tag' || c.rhs.tag !== '');

/** Mệnh đề → biểu thức; còn ô Tag trống thì chuỗi rỗng (chưa chạy được). */
export function formatCondition(join: 'and' | 'or', clauses: readonly Clause[]): string {
  if (clauses.length === 0 || !clauses.every(clauseComplete)) return '';
  return clauses.map(formatClause).join(join === 'and' ? ' && ' : ' || ');
}

/** Viết lại biểu thức chỉ khi nghĩa đổi (giữ cách viết của người dùng). */
function keepOrFormat(src: string, join: 'and' | 'or', clauses: readonly Clause[]): string {
  const old = parseCondition(src);
  const next = formatCondition(join, clauses);
  if (old && formatCondition(old.join, old.clauses) === next) return src;
  return next;
}

const conditionTrigger = (src: string, holdMs: number): Trigger => {
  const c = parseCondition(src);
  return c
    ? { type: 'value', join: c.join, clauses: c.clauses, holdMs }
    : { type: 'advanced', when: src };
};

// ---------- Giờ ----------

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validHm = (s: string) => HM.test(s);
const toMin = (s: string) => {
  const m = HM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const toHm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const plusMinute = (s: string) => (validHm(s) ? toHm(toMin(s) + 1) : s);

// ---------- Hành động ----------

type TagInfo = Pick<TagV1, 'id' | 'kind' | 'type' | 'access' | 'min' | 'max'> &
  Partial<Pick<TagV1, 'description' | 'unit'>>;

function addPattern(expr: string, tag: string): number | null {
  const p = parseExpression(expr);
  if ('error' in p) return null;
  const n = unparen(p.root);
  if (n.t !== 'bin' || (n.op !== '+' && n.op !== '-')) return null;
  const l = unparen(n.l);
  const r = constOf(n.r);
  if (l.t !== 'tag' || l.id !== tag || typeof r !== 'number') return null;
  return n.op === '+' ? r : -r;
}

/** Hành động logic.json → câu (null: không đọc được). */
export function readAction(a: LogicAction, doc: LogicDoc): CardAction | null {
  let tag: string;
  let write: string | undefined;
  if (a.do === 'setTag' || a.do === 'toggle') tag = a.tag ?? '';
  else if (a.do === 'write' || a.do === 'pulse') {
    const w = (doc.writes ?? []).find((x) => x.id === a.write);
    if (!w) return null;
    tag = w.tag;
    write = w.id;
  } else return null;
  const base = { tag, src: clone(a), ...(write ? { write } : {}) };
  if (a.do === 'toggle') return { ...base, verb: 'toggle' };
  const v = a.value;
  if (a.do === 'pulse') {
    if (typeof v === 'object' || v === undefined || typeof a.ms !== 'number') return null;
    return { ...base, verb: 'pulse', value: v, ms: a.ms };
  }
  if (v === undefined) return null;
  if (typeof v === 'object') {
    const n = addPattern(v.expr, tag);
    if (n !== null) return { ...base, verb: 'add', value: n };
    return { ...base, verb: 'expr', expr: v.expr };
  }
  if (v === true) return { ...base, verb: 'on' };
  if (v === false) return { ...base, verb: 'off' };
  return { ...base, verb: 'set', value: v };
}

const sameAction = (a: CardAction, b: CardAction) => {
  const strip = (x: CardAction) => {
    const rest: Partial<CardAction> = { ...x };
    delete rest.src;
    delete rest.write;
    return rest;
  };
  return eq(strip(a), strip(b));
};

/** Tag ghi qua thiết bị (write/pulse) hay đặt nội bộ (setTag/toggle). */
const isDevice = (t: TagInfo | undefined) => t !== undefined && t.kind === 'external';

function allowedFor(t: TagInfo | undefined): { values: Scalar[] } | { min: number; max: number } {
  if (!t || t.type === 'BOOL') return { values: [true, false] };
  if (t.type === 'STRING') return { values: [''] };
  const lo = typeof t.min === 'number' ? t.min : -1e9;
  const hi = typeof t.max === 'number' ? t.max : 1e9;
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/** Tiền tố id của mục writes do thẻ tạo tự động (xóa khi không còn ai dùng). */
export const AUTO_WRITE_PREFIX = 'wa_';

function idPart(tag: string): string {
  const s = tag
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.slice(0, 40) || 'tag';
}

/** Mục writes cho Tag thiết bị: dùng mục có sẵn (ưu tiên mục cũ của hành động), không có thì tạo `wa_<tag>`. */
function ensureWrite(
  doc: LogicDoc,
  tag: string,
  prefer: string | undefined,
  tags: Map<string, TagInfo>,
): string {
  const list = doc.writes ?? [];
  const old = list.find((w) => w.id === prefer && w.tag === tag);
  if (old) return old.id;
  const found = list.find((w) => w.tag === tag);
  if (found) return found.id;
  const used = new Set<string>();
  for (const k of [
    'rules',
    'timers',
    'counters',
    'totalizers',
    'runhours',
    'schedules',
    'writes',
  ] as const)
    for (const b of (doc[k] ?? []) as Array<{ id: string }>) used.add(b.id);
  const base = `${AUTO_WRITE_PREFIX}${idPart(tag)}`.slice(0, 48);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base.slice(0, 44)}_${n}`;
  doc.writes = [
    ...list,
    { id, tag, allowed: allowedFor(tags.get(tag)), minIntervalMs: 1000, maxPerHour: 60 },
  ];
  return id;
}

function encodeAction(doc: LogicDoc, a: CardAction, tags: Map<string, TagInfo>): LogicAction {
  if (a.src) {
    const back = readAction(a.src, doc);
    if (back && sameAction(back, a) && back.tag === a.tag) return clone(a.src);
  }
  const t = tags.get(a.tag);
  const value = (): LogicAction['value'] => {
    switch (a.verb) {
      case 'on':
        return true;
      case 'off':
        return false;
      case 'add': {
        const n = typeof a.value === 'number' ? a.value : 1;
        return { expr: n >= 0 ? `${a.tag} + ${n}` : `${a.tag} - ${-n}` };
      }
      case 'expr':
        return { expr: a.expr ?? '' };
      default:
        return a.value ?? (t?.type === 'BOOL' ? true : 0);
    }
  };
  if (a.verb === 'toggle') return { do: 'toggle', tag: a.tag };
  if (a.verb === 'pulse') {
    const write = ensureWrite(doc, a.tag, a.write, tags);
    return { do: 'pulse', write, value: value()!, ms: a.ms ?? 1000 };
  }
  if (isDevice(t)) {
    const write = ensureWrite(doc, a.tag, a.write, tags);
    return { do: 'write', write, value: value()! };
  }
  return { do: 'setTag', tag: a.tag, value: value()! };
}

// ---------- Đọc thẻ ----------

const findSchedule = (doc: LogicDoc, out: string) =>
  (doc.schedules ?? []).find((s) => s.out === out.trim());

function ruleTrigger(doc: LogicDoc, r: Block): Trigger {
  const when = typeof r.when === 'string' ? r.when : '';
  const hold = typeof r.hold === 'number' ? r.hold : 0;
  const rep = typeof r.repeatMs === 'number' ? r.repeatMs : 0;
  if (when.trim() === 'true' && rep > 0 && r.fireOnStart === true)
    return { type: 'every', everyMs: rep };
  const s = when.trim() ? findSchedule(doc, when) : undefined;
  if (s && rep === 0 && (s.weekly ?? []).length === 1) {
    const w = s.weekly[0]!;
    return {
      type: 'time',
      schedule: s.id,
      days: [...w.days],
      from: w.from,
      to: w.to,
      at: validHm(w.from) && w.to === plusMinute(w.from),
    };
  }
  if (rep > 0 || r.fireOnStart === true) return { type: 'advanced', when };
  return conditionTrigger(when, hold);
}

function actionsOf(list: unknown, doc: LogicDoc): CardAction[] | null {
  const out: CardAction[] = [];
  for (const a of Array.isArray(list) ? (list as LogicAction[]) : []) {
    const c = readAction(a, doc);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

export function readRuleCard(doc: LogicDoc, r: Block): RuleCard {
  return {
    kind: 'rule',
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    enabled: r.enabled !== false,
    trigger: ruleTrigger(doc, r),
    rise: actionsOf(r.onRise, doc),
    fall: actionsOf(r.onFall, doc),
    srcWhen: typeof r.when === 'string' ? r.when : '',
  };
}

/** Lịch chỉ phục vụ đúng một luật "Theo giờ" (ẩn khỏi danh sách, hiện trong thẻ của luật). */
function scheduleOwners(doc: LogicDoc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of blocksOf(doc, 'rule')) {
    const s = typeof r.when === 'string' && r.when.trim() ? findSchedule(doc, r.when) : undefined;
    if (s) out.set(s.id, [...(out.get(s.id) ?? []), r.id]);
  }
  return out;
}

/** Mọi thẻ theo thứ tự: luật (thứ tự của logic.json), timer, counter, rồi các khối khác (lịch rời, cộng dồn, giờ chạy). */
export function readCards(doc: LogicDoc | null | undefined): Card[] {
  if (!doc) return [];
  const cards: Card[] = blocksOf(doc, 'rule').map((r) => readRuleCard(doc, r));
  for (const t of blocksOf(doc, 'timer')) {
    const src = typeof t.in === 'string' ? t.in : '';
    cards.push({
      kind: 'timer',
      id: t.id,
      timerKind: String(t.kind),
      input: conditionTrigger(src, 0),
      pt: typeof t.pt === 'number' ? t.pt : 0,
      q: String(t.q ?? ''),
      srcIn: src,
    });
  }
  for (const c of blocksOf(doc, 'counter')) {
    const up = typeof c.up === 'string' ? c.up : '';
    const reset = typeof c.reset === 'string' ? c.reset : null;
    cards.push({
      kind: 'counter',
      id: c.id,
      up: conditionTrigger(up, 0),
      reset: reset === null ? null : conditionTrigger(reset, 0),
      preset: typeof c.preset === 'number' ? c.preset : null,
      value: String(c.value ?? ''),
      reached: String(c.reached ?? ''),
      srcUp: up,
      srcReset: reset,
    });
  }
  const owners = scheduleOwners(doc);
  const ruleTime = new Set(
    cards.flatMap((c) =>
      c.kind === 'rule' && c.trigger.type === 'time' ? [c.trigger.schedule] : [],
    ),
  );
  for (const k of ['schedule', 'totalizer', 'runhours'] as const)
    for (const b of blocksOf(doc, k)) {
      if (k === 'schedule' && ruleTime.has(b.id) && (owners.get(b.id) ?? []).length === 1) continue;
      cards.push({ kind: 'other', blockKind: k, id: b.id });
    }
  return cards;
}

/** Id các khối (và mục writes) thuộc một thẻ: để gom lỗi của validator vào thẻ. */
export function cardBlockIds(c: Card): string[] {
  if (c.kind !== 'rule') return [c.id];
  const ids = [c.id];
  if (c.trigger.type === 'time' && c.trigger.schedule) ids.push(c.trigger.schedule);
  for (const a of [...(c.rise ?? []), ...(c.fall ?? [])]) if (a.write) ids.push(a.write);
  return ids;
}

// ---------- Ghi thẻ ----------

const tagMap = (tags: readonly TagInfo[]) => new Map(tags.map((t) => [t.id, t]));

function setOrDelete(b: Record<string, unknown>, k: string, v: unknown, dflt: unknown): void {
  if (v === dflt && !(k in b)) return;
  if (b[k] === v) return;
  b[k] = v;
}

function pruneAutoWrites(doc: LogicDoc): void {
  if (!doc.writes) return;
  const used = new Set<string>();
  for (const r of doc.rules ?? [])
    for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])]) if (a.write) used.add(a.write);
  doc.writes = doc.writes.filter((w) => !w.id.startsWith(AUTO_WRITE_PREFIX) || used.has(w.id));
}

function scheduleUsers(doc: LogicDoc, out: string, except: string): number {
  return blocksOf(doc, 'rule').filter(
    (r) => r.id !== except && typeof r.when === 'string' && r.when.trim() === out,
  ).length;
}

/** Ghi một thẻ luật vào logic.json (thẻ đọc ra rồi ghi lại không đổi gì thì tài liệu giữ nguyên). */
export function writeRuleCard(doc: LogicDoc, card: RuleCard, tags: readonly TagInfo[]): LogicDoc {
  const next = clone(doc);
  const rules = (next.rules ?? []) as unknown as Block[];
  const r = rules.find((x) => x.id === card.id);
  if (!r) return doc;
  const tm = tagMap(tags);
  const prev = readRuleCard(doc, r);
  if (card.name !== prev.name) {
    if (card.name === '') delete r.name;
    else r.name = card.name;
  }
  if (card.enabled !== prev.enabled) r.enabled = card.enabled;
  const tr = card.trigger;
  const prevTr = prev.trigger;
  if (!eq(tr, prevTr)) {
    // rời kiểu cũ
    if (prevTr.type === 'every' && tr.type !== 'every') {
      delete r.repeatMs;
      delete r.fireOnStart;
    }
    if (prevTr.type === 'time' && (tr.type !== 'time' || tr.schedule !== prevTr.schedule)) {
      const s = (next.schedules ?? []).find((x) => x.id === prevTr.schedule);
      if (s && scheduleUsers(next, s.out, card.id) === 0)
        next.schedules = (next.schedules ?? []).filter((x) => x.id !== prevTr.schedule);
    }
    switch (tr.type) {
      case 'value':
        r.when = keepOrFormat(card.srcWhen, tr.join, tr.clauses);
        setOrDelete(r, 'hold', tr.holdMs, 0);
        break;
      case 'every':
        r.when = 'true';
        r.fireOnStart = true;
        r.repeatMs = tr.everyMs;
        if ('hold' in r) r.hold = 0;
        break;
      case 'time': {
        const scheds = next.schedules ?? [];
        let s = scheds.find((x) => x.id === tr.schedule);
        const to = tr.at ? plusMinute(tr.from) : tr.to;
        const weekly = { days: [...tr.days].sort((a, b) => a - b), from: tr.from, to };
        if (!s) {
          const id = tr.schedule || suggestId(next, 'schedule');
          s = { id, weekly: [weekly], exceptions: [], out: `LOGIC.${id.toUpperCase()}.Q` };
          next.schedules = [...scheds, s];
        } else if (!eq(s.weekly[0], weekly)) s.weekly = [weekly, ...s.weekly.slice(1)];
        r.when = s.out;
        if ('hold' in r && r.hold !== 0) r.hold = 0;
        break;
      }
      case 'advanced':
        r.when = tr.when;
        break;
    }
  }
  for (const [edge, list, old] of [
    ['onRise', card.rise, prev.rise],
    ['onFall', card.fall, prev.fall],
  ] as const) {
    if (list === null) continue;
    if (old !== null && eq(list, old)) continue;
    r[edge] = list.map((a) => encodeAction(next, a, tm));
  }
  pruneAutoWrites(next);
  return next;
}

/** Ghi thẻ timer (đầu vào, loại, thời gian). */
export function writeTimerCard(doc: LogicDoc, card: TimerCard): LogicDoc {
  const next = clone(doc);
  const t = (next.timers ?? []).find((x) => x.id === card.id) as unknown as Block | undefined;
  if (!t) return doc;
  if (t.kind !== card.timerKind) t.kind = card.timerKind;
  if (t.pt !== card.pt) t.pt = card.pt;
  if (card.input.type === 'value')
    t.in = keepOrFormat(card.srcIn, card.input.join, card.input.clauses);
  else if (card.input.type === 'advanced') t.in = card.input.when;
  return next;
}

/** Ghi thẻ đếm. */
export function writeCounterCard(doc: LogicDoc, card: CounterCard): LogicDoc {
  const next = clone(doc);
  const c = (next.counters ?? []).find((x) => x.id === card.id) as unknown as Block | undefined;
  if (!c) return doc;
  if (card.up.type === 'value') c.up = keepOrFormat(card.srcUp, card.up.join, card.up.clauses);
  if (card.reset === null) {
    if (c.reset !== null && c.reset !== undefined) c.reset = null;
  } else if (card.reset.type === 'value') {
    const s = keepOrFormat(card.srcReset ?? '', card.reset.join, card.reset.clauses);
    c.reset = s === '' ? null : s;
  }
  if ((c.preset ?? null) !== card.preset) c.preset = card.preset;
  return next;
}

// ---------- Thao tác danh sách ----------

/** Nhân bản một luật (và Lịch riêng của nó) với id mới, đặt ngay sau bản gốc. */
export function duplicateRule(doc: LogicDoc, id: string): { doc: LogicDoc; id: string } {
  const next = clone(doc);
  const rules = (next.rules ?? []) as unknown as Block[];
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) return { doc, id };
  const copy = clone(rules[i]!);
  const nid = suggestId(next, 'rule');
  copy.id = nid;
  if (typeof copy.name === 'string' && copy.name)
    copy.name = t('lgc.copyName', { name: copy.name }).slice(0, 80);
  const card = readRuleCard(doc, rules[i]!);
  if (card.trigger.type === 'time') {
    const s = (next.schedules ?? []).find((x) => x.id === (card.trigger as TimeTrigger).schedule);
    if (s) {
      const sid = suggestId(next, 'schedule');
      const ns = { ...clone(s), id: sid, out: `LOGIC.${sid.toUpperCase()}.Q` };
      next.schedules = [...(next.schedules ?? []), ns];
      copy.when = ns.out;
    }
  }
  rules.splice(i + 1, 0, copy);
  next.rules = rules as unknown as LogicDoc['rules'];
  return { doc: next, id: nid };
}

/** Xóa một luật (và Lịch riêng không ai khác dùng, mục writes tự tạo không còn dùng). */
export function removeRule(doc: LogicDoc, id: string): LogicDoc {
  const r = blocksOf(doc, 'rule').find((x) => x.id === id);
  if (!r) return doc;
  const card = readRuleCard(doc, r);
  const next = clone(doc);
  next.rules = (next.rules ?? []).filter((x) => x.id !== id);
  if (card.trigger.type === 'time') {
    const s = (next.schedules ?? []).find((x) => x.id === (card.trigger as TimeTrigger).schedule);
    if (s && scheduleUsers(next, s.out, id) === 0)
      next.schedules = (next.schedules ?? []).filter((x) => x.id !== s.id);
  }
  pruneAutoWrites(next);
  return next;
}

/** Kéo đổi thứ tự luật: đưa `id` tới vị trí của `before` (null: cuối). */
export function reorderRule(doc: LogicDoc, id: string, before: string | null): LogicDoc {
  const list = clone(doc.rules ?? []);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0 || id === before) return doc;
  const [r] = list.splice(i, 1);
  const j = before === null ? list.length : list.findIndex((x) => x.id === before);
  list.splice(j < 0 ? list.length : j, 0, r!);
  if (eq(list, doc.rules)) return doc;
  return { ...clone(doc), rules: list };
}

// ---------- Mẫu ----------

export type TemplateId =
  'equal' | 'threshold' | 'at' | 'every' | 'onoff' | 'count' | 'delay' | 'interlock';
export const TEMPLATES: readonly TemplateId[] = [
  'equal',
  'threshold',
  'at',
  'every',
  'onoff',
  'count',
  'delay',
  'interlock',
];

/** Điều kiện nháp của mẫu (Tag chưa chọn nên chưa viết được thành biểu thức). */
export interface TemplateResult {
  doc: LogicDoc;
  /** Thẻ chính (luật, hoặc counter). */
  id: string;
  /** Điều kiện nháp theo id khối (editor giữ cho tới khi đủ Tag). */
  drafts: Record<string, ValueTrigger>;
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function newRule(doc: LogicDoc, name: string): { doc: LogicDoc; id: string } {
  const id = suggestId(doc, 'rule');
  const rule = { id, name, enabled: true, when: '', hold: 0, onRise: [], onFall: [] };
  return { doc: { ...doc, rules: [...(doc.rules ?? []), rule] }, id };
}

/** Thêm luật (hoặc khối) từ một mẫu; mọi ô Tag còn trống để người dùng chọn. */
export function addFromTemplate(
  doc: LogicDoc,
  tpl: TemplateId,
  name: string,
  tags: readonly TagInfo[],
): TemplateResult {
  const base = clone(doc);
  const drafts: Record<string, ValueTrigger> = {};
  const rule = (trigger: Trigger, rise: CardAction[], fall: CardAction[] = []) => {
    const r = newRule(base, name);
    const card: RuleCard = {
      ...readRuleCard(r.doc, r.doc.rules!.find((x) => x.id === r.id) as unknown as Block),
      trigger,
      rise,
      fall,
    };
    if (trigger.type === 'value') drafts[r.id] = trigger;
    return { doc: writeRuleCard(r.doc, card, tags), id: r.id };
  };
  const v = (clauses: Clause[], holdMs = 0, join: 'and' | 'or' = 'and'): ValueTrigger => ({
    type: 'value',
    join,
    clauses,
    holdMs,
  });
  switch (tpl) {
    case 'equal': {
      const r = rule(v([{ tag: '', test: 'cmp', op: '==', rhs: { kind: 'const', v: 1 } }]), [
        { verb: 'on', tag: '' },
      ]);
      return { ...r, drafts };
    }
    case 'threshold': {
      const r = rule(v([{ tag: '', test: 'cmp', op: '>', rhs: { kind: 'const', v: 80 } }], 5000), [
        { verb: 'off', tag: '' },
      ]);
      return { ...r, drafts };
    }
    case 'at': {
      const r = rule(
        { type: 'time', schedule: '', days: ALL_DAYS, from: '07:00', to: '07:01', at: true },
        [{ verb: 'on', tag: '' }],
      );
      return { ...r, drafts };
    }
    case 'every': {
      const r = rule({ type: 'every', everyMs: 300_000 }, [{ verb: 'add', tag: '', value: 1 }]);
      return { ...r, drafts };
    }
    case 'onoff': {
      const r = rule(
        {
          type: 'time',
          schedule: '',
          days: [1, 2, 3, 4, 5],
          from: '07:00',
          to: '17:00',
          at: false,
        },
        [{ verb: 'on', tag: '' }],
        [{ verb: 'off', tag: '' }],
      );
      return { ...r, drafts };
    }
    case 'count': {
      const id = suggestId(base, 'counter');
      const up = id.toUpperCase();
      base.counters = [
        ...(base.counters ?? []),
        {
          id,
          up: '',
          down: null,
          reset: null,
          preset: 10,
          value: `LOGIC.${up}.VALUE`,
          reached: `LOGIC.${up}.REACHED`,
          retain: true,
        },
      ];
      drafts[id] = v([{ tag: '', test: 'on' }]);
      return { doc: base, id, drafts };
    }
    case 'delay': {
      const tid = suggestId(base, 'timer');
      const q = `LOGIC.${tid.toUpperCase()}.Q`;
      base.timers = [
        ...(base.timers ?? []),
        { id: tid, kind: 'ton', in: '', pt: 5000, q, et: `LOGIC.${tid.toUpperCase()}.ET` },
      ];
      drafts[tid] = v([{ tag: '', test: 'on' }]);
      const r = rule(
        v([{ tag: q, test: 'on' }]),
        [{ verb: 'on', tag: '' }],
        [{ verb: 'off', tag: '' }],
      );
      delete drafts[r.id];
      return { ...r, drafts };
    }
    case 'interlock': {
      const r = rule(
        v([
          { tag: '', test: 'on' },
          { tag: '', test: 'off' },
        ]),
        [{ verb: 'off', tag: '' }],
      );
      return { ...r, drafts };
    }
  }
}

// ---------- Thử luật ----------

/** Thứ (1 = T2 … 7 = CN) và giờ địa phương → ms UTC (tuần của 2026-10-12, thứ Hai). */
export function wallFor(day: number, hm: string, tzOffsetMin = 420): number {
  const m = toMin(hm);
  const local = Date.UTC(2026, 9, 12 + (day - 1), 0, Number.isNaN(m) ? 0 : m);
  return local - tzOffsetMin * 60_000;
}

/** Tag logic dễ đọc: `LOGIC.T_1.Q` → "Timer t_1 xong". */
export function logicTagLabel(doc: LogicDoc | null | undefined, tag: string): string | null {
  if (!doc || !tag.startsWith('LOGIC.')) return null;
  for (const tm of doc.timers ?? []) if (tm.q === tag) return t('lgc.out.timer', { id: tm.id });
  for (const c of doc.counters ?? []) {
    if (c.reached === tag) return t('lgc.out.reached', { id: c.id });
    if (c.value === tag) return t('lgc.out.value', { id: c.id });
  }
  for (const s of doc.schedules ?? [])
    if (s.out === tag) return t('lgc.out.schedule', { id: s.id });
  return null;
}
