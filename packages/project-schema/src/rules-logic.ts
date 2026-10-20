// Luật của logic.json (feature 011, T135; FR-073, FR-075, FR-079, FR-093; contracts/logic-engine.md §1-§11). Bản C++
// (core/project-manager/rules_logic, T135) cài CÙNG luật; vector chung tests/logic-vectors (nhóm `static` và mọi ca
// khác phải ra `expectErrors`), README ở đó ghi các quyết định cho chỗ contract chưa nói rõ.
//
// Thứ tự kiểm (tập mã là contract; thứ tự và câu chữ chỉ để dễ đọc):
//  0. `schemaVersion` không phải 1.0.x: E_LOGIC_VERSION và dừng.
//  1. Cỡ tệp > 512 KiB, số mục mỗi mảng vượt LOGIC_LIMITS: E_LOGIC_LIMIT (`/` hoặc `/<mảng>`).
//  2. Id mọi mục (writes và khối, chung một không gian): dạng `^[a-z][a-z0-9_]{0,47}$`, không trùng: E_LOGIC_ID.
//  3. Tag đầu ra: dạng Tag id (E_LOGIC_ID), trùng Tag của tags.json hoặc đầu ra trước đó (E_LOGIC_TAG_COLLISION).
//     Đầu ra hợp lệ được khai thành Tag logic (kiểu theo trường) và dùng được trong biểu thức của logic.
//  4. writes: Tag có (E_LOGIC_TAG_REF), là Tag ngoài RW (E_LOGIC_WRITE_TARGET), `allowed` hợp kiểu và min ≤ max
//     (E_LOGIC_WRITE_VALUE), minIntervalMs 1.000–86.400.000 và maxPerHour 1–3.600, bắt buộc (E_LOGIC_LIMIT).
//  5. Từng khối: biểu thức (E_LOGIC_TAG_REF, E_LOGIC_TYPE, E_LOGIC_EXPR, E_LOGIC_LIMIT), miền tham số
//     (E_LOGIC_TIMER, E_LOGIC_COUNTER, E_LOGIC_TOTALIZER, E_LOGIC_SCHEDULE, E_LOGIC_LIMIT), hành động của luật
//     (E_LOGIC_ACTION, E_LOGIC_WRITE_UNDECLARED, E_LOGIC_WRITE_VALUE, E_LOGIC_TYPE, E_LOGIC_TAG_REF).
//  6. Đồ thị khối (cạnh A → B khi biểu thức của B đọc đầu ra của A): mỗi thành phần liên thông mạnh có vòng là một
//     E_LOGIC_CYCLE tại khối có id nhỏ nhất. Luật đọc (trực tiếp, qua khối, qua Tag tính toán) Tag mà setTag/toggle
//     của chính nó đặt: E_LOGIC_SELF_TRIGGER.
//  7. Cảnh báo: W_LOGIC_PT_ROUNDED, W_LOGIC_DISABLED, W_LOGIC_NO_HOLD, W_LOGIC_WRITE_CONFLICT, W_LOGIC_RETAIN_IO,
//     W_LOGIC_WRITES_OFF (chỉ khi biết thiết bị đích đang tắt ghi).
// Biểu thức không biên dịch được không góp cạnh nào vào đồ thị (hai bản cùng quy ước).
import { compile, type TagDataType } from '@mat/expression';
import type { ErrorCode, Issue, WarningCode } from './codes.ts';
import { isValidTagId } from './rename.ts';
import type { TagKind, TagV1 } from './types-02.ts';
import type { LogicAction, LogicDoc, LogicScalar, LogicValue, LogicWrite } from './types-10.ts';

export const LOGIC_LIMITS = {
  rules: 200,
  timers: 100,
  counters: 100,
  totalizers: 50,
  runhours: 50,
  schedules: 50,
  writes: 100,
  actionsPerRule: 8,
  windows: 16,
  exceptions: 64,
  maxPerHour: 3600,
  fileBytes: 512 * 1024,
} as const;
/** Mặc định của runtime.json (device-api-011 §5) khi bộ kiểm không biết cấu hình thiết bị. */
export const LOGIC_DEFAULTS = { scanMs: 100, flushS: 60, tzOffsetMin: 420 } as const;
/** Ngưỡng cảnh báo ghi đĩa của retain (contract §9): 100 MiB/ngày. */
export const LOGIC_RETAIN_IO_LIMIT = 100 * 1024 * 1024;
const MAX_MS = 86_400_000;
const ID_RE = /^[a-z][a-z0-9_]{0,47}$/;
const HHMM_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
/** Miền số nguyên của kiểu Tag: [nhỏ nhất, lớn nhất + 1) (biên trên mở để INT64/UINT64 đúng trên double). */
const INT_RANGE: Partial<Record<TagDataType, [number, number]>> = {
  INT16: [-(2 ** 15), 2 ** 15],
  UINT16: [0, 2 ** 16],
  INT32: [-(2 ** 31), 2 ** 31],
  UINT32: [0, 2 ** 32],
  INT64: [-(2 ** 63), 2 ** 63],
  UINT64: [0, 2 ** 64],
};

/** Thông tin Tag mà luật logic cần. */
export interface LogicTagInfo {
  type: TagDataType;
  kind: TagKind;
  access?: 'R' | 'RW';
  /** Tag tính toán: biểu thức (dùng cho E_LOGIC_SELF_TRIGGER gián tiếp). */
  expression?: string;
}

export interface LogicCheckOptions {
  /** Tag của tags.json. */
  tags: ReadonlyMap<string, LogicTagInfo>;
  file?: string;
  /** Cỡ tệp logic.json (byte) nếu biết. */
  bytes?: number;
  hasTable?: (name: string) => boolean;
  scanMs?: number;
  flushS?: number;
  /** Trạng thái `logic.writes` của thiết bị đích (Studio khi Online); vắng: không kiểm W_LOGIC_WRITES_OFF. */
  deviceWrites?: 'on' | 'off';
}

export interface LogicOutput {
  tag: string;
  type: TagDataType;
  block: string;
  field: string;
}

/** Tag id → thông tin, từ danh sách tags.json (bản đầu tiên nếu trùng). */
export function logicTagsFromList(tags: readonly TagV1[]): Map<string, LogicTagInfo> {
  const m = new Map<string, LogicTagInfo>();
  for (const t of tags) {
    if (m.has(t.id)) continue;
    m.set(t.id, {
      type: t.type,
      kind: t.kind,
      ...(t.access ? { access: t.access } : {}),
      ...(t.expression !== undefined ? { expression: t.expression } : {}),
    });
  }
  return m;
}

type Field = readonly [field: string, type: TagDataType];
const OUT_FIELDS: Record<string, readonly Field[]> = {
  timers: [
    ['q', 'BOOL'],
    ['et', 'INT64'],
  ],
  counters: [
    ['value', 'INT64'],
    ['reached', 'BOOL'],
  ],
  totalizers: [
    ['total', 'FLOAT64'],
    ['gapSeconds', 'FLOAT64'],
  ],
  runhours: [
    ['hours', 'FLOAT64'],
    ['starts', 'INT64'],
    ['due', 'BOOL'],
  ],
  schedules: [['out', 'BOOL']],
};
/** Ô biểu thức của từng loại khối: [trường, kiểu đích khi biên dịch, có thể null]. */
const EXPR_FIELDS: Record<string, ReadonlyArray<readonly [string, TagDataType, boolean]>> = {
  rules: [['when', 'BOOL', false]],
  timers: [['in', 'BOOL', false]],
  counters: [
    ['up', 'BOOL', false],
    ['down', 'BOOL', true],
    ['reset', 'BOOL', true],
  ],
  totalizers: [
    ['source', 'FLOAT64', false],
    ['reset', 'BOOL', true],
  ],
  runhours: [
    ['run', 'BOOL', false],
    ['reset', 'BOOL', true],
  ],
  schedules: [],
};
/** Loại khối theo thứ tự kiểm. */
export const LOGIC_BLOCK_KINDS = [
  'rules',
  'timers',
  'counters',
  'totalizers',
  'runhours',
  'schedules',
] as const;
export type LogicBlockKind = (typeof LOGIC_BLOCK_KINDS)[number];

type AnyBlock = Record<string, unknown> & { id: string };
const blocksOf = (doc: LogicDoc, kind: LogicBlockKind): AnyBlock[] =>
  ((doc[kind] ?? []) as unknown as AnyBlock[]).filter((b) => typeof b === 'object' && b !== null);

/** Mọi đầu ra khai trong logic.json, theo thứ tự loại khối, khối, trường (kể cả đầu ra sai dạng hoặc trùng). */
export function logicOutputs(doc: LogicDoc): LogicOutput[] {
  const out: LogicOutput[] = [];
  for (const kind of LOGIC_BLOCK_KINDS) {
    const fields = OUT_FIELDS[kind];
    if (!fields) continue;
    for (const b of blocksOf(doc, kind))
      for (const [field, type] of fields) {
        const tag = b[field];
        if (typeof tag === 'string') out.push({ tag, type, block: b.id, field });
      }
  }
  return out;
}

/**
 * Tag logic khai thành Tag nội bộ chỉ đọc (contract §1): đầu ra đúng dạng Tag id, không trùng Tag của tags.json và
 * không trùng đầu ra trước đó (cùng tập đầu ra mà checkLogic nhận). Bộ kiểm project 1.0 nối các Tag này vào cuối
 * danh sách Tag trước luật 0.5/0.6 để widget, alarm, lưu trữ, Tag tính toán tham chiếu được.
 */
export function logicTagDefs(doc: LogicDoc, tags: ReadonlyMap<string, LogicTagInfo>): TagV1[] {
  const seen = new Set<string>();
  const out: TagV1[] = [];
  for (const o of logicOutputs(doc)) {
    if (!isValidTagId(o.tag) || tags.has(o.tag) || seen.has(o.tag)) continue;
    seen.add(o.tag);
    out.push({ id: o.tag, kind: 'internal', type: o.type, access: 'R' });
  }
  return out;
}

/** Biểu thức đầu vào của một khối: [trường, nguồn, kiểu đích]. */
export function logicExpressions(
  kind: LogicBlockKind,
  block: Record<string, unknown>,
): Array<[string, string, TagDataType]> {
  const out: Array<[string, string, TagDataType]> = [];
  for (const [f, t] of EXPR_FIELDS[kind] ?? []) {
    const v = block[f];
    if (typeof v === 'string') out.push([f, v, t]);
  }
  return out;
}

type Env = LogicEnv;

/** Tag đầu vào của biểu thức (rỗng khi không biên dịch được). */
function refsOf(src: string, target: TagDataType, env: Env): string[] {
  const r = compile(src, { ...env, target });
  return r.ok ? r.inputs : [];
}

/**
 * Thứ tự quét: sắp xếp tô-pô ổn định (Kahn, chọn id nhỏ nhất trong các khối sẵn sàng; so theo đơn vị mã UTF-16,
 * id chỉ là ASCII). `cycles`: các thành phần liên thông mạnh có vòng, mỗi thành phần sắp theo id, danh sách sắp theo
 * id đầu. Khối trong vòng (và khối phụ thuộc vào vòng) không có trong `order`.
 */
export function logicOrder(
  doc: LogicDoc,
  env?: LogicEnv,
  outs?: ReadonlyMap<string, LogicOutput>,
): { order: string[]; cycles: string[][] } {
  const { order, cycles } = logicGraph(doc, env, outs);
  return { order, cycles };
}

/** Môi trường biên dịch biểu thức của logic: kiểu Tag (tags.json và Tag logic), bảng giá trị. */
export interface LogicEnv {
  tagType: (id: string) => TagDataType | undefined;
  hasTable: (name: string) => boolean;
}

function logicGraph(
  doc: LogicDoc,
  env?: LogicEnv,
  outs?: ReadonlyMap<string, LogicOutput>,
): { order: string[]; cycles: string[][]; deps: Map<string, string[]> } {
  const outputs = new Map<string, LogicOutput>(outs ?? []);
  if (!outs) for (const o of logicOutputs(doc)) if (!outputs.has(o.tag)) outputs.set(o.tag, o);
  const e: Env = env ?? {
    tagType: (id) => outputs.get(id)?.type ?? 'FLOAT64',
    hasTable: () => true,
  };
  const ids: string[] = [];
  const deps = new Map<string, string[]>();
  for (const kind of LOGIC_BLOCK_KINDS)
    for (const b of blocksOf(doc, kind)) {
      if (deps.has(b.id)) continue;
      ids.push(b.id);
      const d = new Set<string>();
      for (const [, src, t] of logicExpressions(kind, b))
        for (const ref of refsOf(src, t, e)) {
          const o = outputs.get(ref);
          if (o) d.add(o.block);
        }
      deps.set(b.id, [...d].sort());
    }
  // Kahn
  const users = new Map<string, string[]>(ids.map((id) => [id, []]));
  const missing = new Map<string, number>();
  for (const id of ids) {
    const d = deps.get(id)!;
    missing.set(id, d.length);
    for (const x of d) users.get(x)?.push(id);
  }
  const ready = ids.filter((id) => missing.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const u of users.get(id) ?? []) {
      const n = missing.get(u)! - 1;
      missing.set(u, n);
      if (n === 0) {
        ready.push(u);
        ready.sort();
      }
    }
  }
  // Tarjan cho thành phần liên thông mạnh (chỉ để báo vòng)
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let next = 0;
  const visit = (v: string): void => {
    index.set(v, next);
    low.set(v, next);
    next++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || (deps.get(v) ?? []).includes(v)) cycles.push(comp.sort());
    }
  };
  for (const id of [...ids].sort()) if (!index.has(id)) visit(id);
  cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return { order, cycles, deps };
}

/** Hằng có hợp kiểu Tag không (BOOL ↔ boolean, STRING ↔ chuỗi, số nguyên trong miền, số thực hữu hạn). */
export function logicConstFits(type: TagDataType, v: unknown): boolean {
  if (type === 'BOOL') return typeof v === 'boolean';
  if (type === 'STRING') return typeof v === 'string';
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const r = INT_RANGE[type];
  if (!r) return true;
  return Number.isInteger(v) && v >= r[0] && v < r[1];
}

/** Giá trị có thuộc `allowed` của mục writes không (so cùng kiểu; bigint so như số). */
export function logicAllowed(
  allowed: { values: LogicScalar[] } | { min: number; max: number },
  v: LogicScalar | bigint,
): boolean {
  const x = typeof v === 'bigint' ? Number(v) : v;
  if ('values' in allowed) return allowed.values.some((a) => a === x);
  return typeof x === 'number' && x >= allowed.min && x <= allowed.max;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isExprValue = (v: unknown): v is { expr: string } =>
  typeof v === 'object' && v !== null && typeof (v as { expr?: unknown }).expr === 'string';
const numericType = (t: TagDataType) => t !== 'BOOL' && t !== 'STRING';

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= days;
}

export function checkLogic(
  doc: LogicDoc,
  opts: LogicCheckOptions,
): { errors: Issue[]; warnings: Issue[] } {
  const file = opts.file ?? 'logic.json';
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: ErrorCode, path: string, message: string) =>
    errors.push({ code, file, path, message });
  const warn = (code: WarningCode, path: string, message: string) =>
    warnings.push({ code, file, path, message });
  const scanMs = opts.scanMs ?? LOGIC_DEFAULTS.scanMs;
  const flushS = opts.flushS ?? LOGIC_DEFAULTS.flushS;
  const tags = opts.tags;

  // 0. phiên bản (họ 1.x: 1.0 và 1.1 dùng cùng định dạng logic.json, feature 012)
  if (!/^1\.[01]\.\d+$/.test(doc.schemaVersion)) {
    err(
      'E_LOGIC_VERSION',
      '/schemaVersion',
      `logic.json ${doc.schemaVersion}: chỉ hiểu 1.0.x, 1.1.x`,
    );
    return { errors, warnings };
  }

  // 1. giới hạn tệp và số mục
  if (opts.bytes !== undefined && opts.bytes > LOGIC_LIMITS.fileBytes)
    err('E_LOGIC_LIMIT', '', `logic.json ${opts.bytes} byte > ${LOGIC_LIMITS.fileBytes}`);
  for (const k of ['writes', ...LOGIC_BLOCK_KINDS] as const) {
    const n = (doc[k] ?? []).length;
    if (n > LOGIC_LIMITS[k]) err('E_LOGIC_LIMIT', `/${k}`, `${n} mục ${k} > ${LOGIC_LIMITS[k]}`);
  }
  // T062: vượt giới hạn thì không xét tiếp (không dựng đồ thị của 10^5 khối)
  if (errors.length > 0) return { errors, warnings };

  // 2. id
  const seenIds = new Set<string>();
  const idCheck = (id: unknown, path: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      err('E_LOGIC_ID', path, `id '${String(id)}' sai dạng (^[a-z][a-z0-9_]{0,47}$)`);
      return;
    }
    if (seenIds.has(id)) err('E_LOGIC_ID', path, `id '${id}' bị trùng`);
    seenIds.add(id);
  };
  (doc.writes ?? []).forEach((w, i) => idCheck(w.id, `/writes/${i}/id`));
  for (const kind of LOGIC_BLOCK_KINDS)
    blocksOf(doc, kind).forEach((b, i) => idCheck(b.id, `/${kind}/${i}/id`));

  // 3. đầu ra
  const outputs = new Map<string, LogicOutput>();
  for (const kind of LOGIC_BLOCK_KINDS) {
    const fields = OUT_FIELDS[kind];
    if (!fields) continue;
    blocksOf(doc, kind).forEach((b, i) => {
      for (const [field, type] of fields) {
        const tag = b[field];
        if (typeof tag !== 'string') continue;
        const p = `/${kind}/${i}/${field}`;
        if (!isValidTagId(tag)) err('E_LOGIC_ID', p, `Tag đầu ra '${tag}' sai dạng`);
        else if (tags.has(tag) || outputs.has(tag))
          err('E_LOGIC_TAG_COLLISION', p, `Tag đầu ra '${tag}' trùng Tag có sẵn hoặc đầu ra khác`);
        else outputs.set(tag, { tag, type, block: b.id, field });
      }
    });
  }
  const env: Env = {
    tagType: (id) => tags.get(id)?.type ?? outputs.get(id)?.type,
    hasTable: opts.hasTable ?? (() => false),
  };

  /** Kiểm một biểu thức; trả true nếu hợp lệ. */
  const exprCheck = (src: string, target: TagDataType, path: string): boolean => {
    const r = compile(src, { ...env, target });
    if (r.ok) return true;
    const e = r.errors[0]!;
    const at = `${path}`;
    if (e.code === 'E_EXPR_UNKNOWN_TAG')
      err('E_LOGIC_TAG_REF', at, `biểu thức '${src}': Tag không có (${e.message})`);
    else if (e.code === 'E_EXPR_LIMIT')
      err('E_LOGIC_LIMIT', at, `biểu thức '${src}' vượt giới hạn của 006`);
    else if (
      e.code === 'E_EXPR_TYPE' &&
      (['BOOL', 'FLOAT64', 'STRING'] as const).some((t) => compile(src, { ...env, target: t }).ok)
    )
      err(
        'E_LOGIC_TYPE',
        at,
        `biểu thức '${src}' không cho kiểu ${target === 'FLOAT64' ? 'số' : target}`,
      );
    else err('E_LOGIC_EXPR', at, `biểu thức '${src}' không hợp lệ (${e.code})`);
    return false;
  };

  // 4. writes
  const writes = new Map<
    string,
    { tag: string; type?: TagDataType; allowed: LogicWrite['allowed'] }
  >();
  (doc.writes ?? []).forEach((w, i) => {
    const p = `/writes/${i}`;
    const t = tags.get(w.tag);
    if (!t) {
      if (outputs.has(w.tag))
        err(
          'E_LOGIC_WRITE_TARGET',
          `${p}/tag`,
          `'${w.tag}' là Tag logic, không phải Tag thiết bị RW`,
        );
      else err('E_LOGIC_TAG_REF', `${p}/tag`, `Tag '${w.tag}' không có`);
    } else if (t.kind !== 'external' || t.access !== 'RW')
      err('E_LOGIC_WRITE_TARGET', `${p}/tag`, `'${w.tag}' không phải Tag thiết bị RW`);
    if (t) {
      const a = w.allowed;
      if ('values' in a) {
        a.values.forEach((v, j) => {
          if (!logicConstFits(t.type, v))
            err(
              'E_LOGIC_WRITE_VALUE',
              `${p}/allowed/values/${j}`,
              `giá trị ${JSON.stringify(v)} sai kiểu ${t.type}`,
            );
        });
      } else if (!numericType(t.type))
        err(
          'E_LOGIC_WRITE_VALUE',
          `${p}/allowed`,
          `min/max chỉ cho Tag số ('${w.tag}' là ${t.type})`,
        );
      else if (a.min > a.max)
        err('E_LOGIC_WRITE_VALUE', `${p}/allowed`, `min ${a.min} > max ${a.max}`);
    }
    if (!isInt(w.minIntervalMs) || w.minIntervalMs < 1000 || w.minIntervalMs > MAX_MS)
      err(
        'E_LOGIC_LIMIT',
        `${p}/minIntervalMs`,
        'minIntervalMs bắt buộc, số nguyên 1.000 đến 86.400.000',
      );
    if (!isInt(w.maxPerHour) || w.maxPerHour < 1 || w.maxPerHour > LOGIC_LIMITS.maxPerHour)
      err('E_LOGIC_LIMIT', `${p}/maxPerHour`, 'maxPerHour bắt buộc, số nguyên 1 đến 3.600');
    if (typeof w.id === 'string' && !writes.has(w.id))
      writes.set(w.id, { tag: w.tag, ...(t ? { type: t.type } : {}), allowed: w.allowed });
  });

  // 5. khối
  const exprBlocks = (kind: LogicBlockKind) => {
    blocksOf(doc, kind).forEach((b, i) => {
      for (const [f, target, nullable] of EXPR_FIELDS[kind] ?? []) {
        const v = b[f];
        if (v === undefined || (v === null && nullable)) continue;
        if (typeof v === 'string') exprCheck(v, target, `/${kind}/${i}/${f}`);
      }
    });
  };
  for (const kind of LOGIC_BLOCK_KINDS) exprBlocks(kind);

  // luật: tham số và hành động
  const VALID_DO = new Set(['setTag', 'toggle', 'write', 'pulse']);
  const ALLOWED_KEYS: Record<string, readonly string[]> = {
    setTag: ['do', 'tag', 'value'],
    toggle: ['do', 'tag'],
    write: ['do', 'write', 'value'],
    pulse: ['do', 'write', 'value', 'ms'],
  };
  (doc.rules ?? []).forEach((r, i) => {
    const p = `/rules/${i}`;
    const hold = r.hold ?? 0;
    if (!isInt(hold) || hold < 0 || hold > MAX_MS)
      err('E_LOGIC_LIMIT', `${p}/hold`, `hold ${hold} ms ngoài 0 đến ${MAX_MS}`);
    const rep = r.repeatMs ?? 0;
    if (!isInt(rep) || (rep !== 0 && (rep < 10000 || rep > MAX_MS)))
      err('E_LOGIC_LIMIT', `${p}/repeatMs`, `repeatMs ${rep}: 0 hoặc 10.000 đến ${MAX_MS}`);
    const n = (r.onRise ?? []).length + (r.onFall ?? []).length;
    if (n > LOGIC_LIMITS.actionsPerRule)
      err('E_LOGIC_LIMIT', p, `${n} hành động > ${LOGIC_LIMITS.actionsPerRule} mỗi luật`);
    for (const list of ['onRise', 'onFall'] as const)
      (r[list] ?? []).forEach((a, j) => actionCheck(a, `${p}/${list}/${j}`));
  });

  function valueCheck(
    v: LogicValue | undefined,
    type: TagDataType,
    path: string,
    isWrite: boolean,
  ): boolean {
    if (isExprValue(v)) return exprCheck(v.expr, type, `${path}/expr`);
    if (!logicConstFits(type, v)) {
      err(
        isWrite ? 'E_LOGIC_WRITE_VALUE' : 'E_LOGIC_TYPE',
        path,
        `giá trị ${JSON.stringify(v)} sai kiểu ${type}`,
      );
      return false;
    }
    return true;
  }

  function actionCheck(a: LogicAction, p: string): void {
    if (!VALID_DO.has(a.do)) {
      err(
        'E_LOGIC_ACTION',
        `${p}/do`,
        `hành động '${a.do}' không có (setTag, toggle, write, pulse)`,
      );
      return;
    }
    const keys = ALLOWED_KEYS[a.do]!;
    const extra = Object.keys(a).filter((k) => !keys.includes(k));
    const missing = keys.filter((k) => !(k in a));
    if (extra.length > 0 || missing.length > 0) {
      err(
        'E_LOGIC_ACTION',
        p,
        `hành động ${a.do}: ${missing.length ? `thiếu ${missing.join(', ')}` : ''}${extra.length ? ` thừa ${extra.join(', ')}` : ''}`.trim(),
      );
      return;
    }
    if (a.do === 'setTag' || a.do === 'toggle') {
      const tag = a.tag!;
      const t = tags.get(tag);
      if (!t) {
        if (outputs.has(tag))
          err('E_LOGIC_ACTION', `${p}/tag`, `'${tag}' là Tag logic: chỉ khối của nó đặt`);
        else err('E_LOGIC_TAG_REF', `${p}/tag`, `Tag '${tag}' không có`);
        return;
      }
      if (t.kind !== 'internal') {
        err('E_LOGIC_ACTION', `${p}/tag`, `${a.do} chỉ cho Tag nội bộ ('${tag}' là ${t.kind})`);
        return;
      }
      if (a.do === 'toggle') {
        if (t.type !== 'BOOL')
          err('E_LOGIC_TYPE', `${p}/tag`, `toggle cần Tag BOOL ('${tag}' là ${t.type})`);
        return;
      }
      valueCheck(a.value, t.type, `${p}/value`, false);
      return;
    }
    // write, pulse
    if (a.do === 'pulse' && (!isInt(a.ms) || a.ms < 100 || a.ms > 10000))
      err('E_LOGIC_ACTION', `${p}/ms`, `ms ${a.ms}: 100 đến 10.000`);
    const w = writes.get(a.write!);
    if (!w) {
      err('E_LOGIC_WRITE_UNDECLARED', `${p}/write`, `mục writes '${a.write}' không có`);
      return;
    }
    if (!w.type) return; // Tag của writes không có: đã báo
    if (valueCheck(a.value, w.type, `${p}/value`, true) && !isExprValue(a.value))
      if (!logicAllowed(w.allowed, a.value as LogicScalar))
        err(
          'E_LOGIC_WRITE_VALUE',
          `${p}/value`,
          `giá trị ${JSON.stringify(a.value)} ngoài allowed của '${a.write}'`,
        );
  }

  (doc.timers ?? []).forEach((t, i) => {
    const p = `/timers/${i}`;
    if (t.kind !== 'ton' && t.kind !== 'tof' && t.kind !== 'tp')
      err('E_LOGIC_TIMER', `${p}/kind`, `kind '${t.kind}' lạ (ton, tof, tp)`);
    if (!isInt(t.pt) || t.pt <= 0 || t.pt > MAX_MS)
      err('E_LOGIC_TIMER', `${p}/pt`, `pt ${t.pt}: 1 đến ${MAX_MS} ms`);
    else if (t.pt < scanMs)
      warn(
        'W_LOGIC_PT_ROUNDED',
        `${p}/pt`,
        `pt ${t.pt} ms nhỏ hơn logic.scanMs ${scanMs} ms: làm tròn lên`,
      );
  });
  (doc.counters ?? []).forEach((c, i) => {
    const p = `/counters/${i}`;
    const preset = c.preset ?? null;
    if (preset !== null && (!isInt(preset) || preset < 1))
      err('E_LOGIC_COUNTER', `${p}/preset`, `preset ${preset}: số nguyên ≥ 1 hoặc null`);
    if (preset === null && c.reached !== undefined)
      err('E_LOGIC_COUNTER', `${p}/reached`, 'reached cần preset');
  });
  (doc.totalizers ?? []).forEach((z, i) => {
    const p = `/totalizers/${i}`;
    if (!['s', 'min', 'h', 'd'].includes(z.rateUnit))
      err('E_LOGIC_TOTALIZER', `${p}/rateUnit`, `rateUnit '${z.rateUnit}' lạ (s, min, h, d)`);
    if (z.factor !== undefined && (!isNum(z.factor) || z.factor <= 0))
      err('E_LOGIC_TOTALIZER', `${p}/factor`, 'factor phải > 0 và hữu hạn');
    if (z.cutoff !== undefined && (!isNum(z.cutoff) || z.cutoff < 0))
      err('E_LOGIC_TOTALIZER', `${p}/cutoff`, 'cutoff phải ≥ 0');
    if (z.maxGapMs !== undefined && (!isInt(z.maxGapMs) || z.maxGapMs <= 0 || z.maxGapMs > MAX_MS))
      err('E_LOGIC_TOTALIZER', `${p}/maxGapMs`, `maxGapMs: 1 đến ${MAX_MS}`);
    if (z.rolloverAt !== undefined && (!isNum(z.rolloverAt) || z.rolloverAt <= 0))
      err('E_LOGIC_TOTALIZER', `${p}/rolloverAt`, 'rolloverAt phải > 0');
  });
  (doc.runhours ?? []).forEach((h, i) => {
    const s = h.serviceEveryHours ?? null;
    if (s !== null && (!isNum(s) || s <= 0))
      err(
        'E_LOGIC_LIMIT',
        `/runhours/${i}/serviceEveryHours`,
        'serviceEveryHours phải > 0 hoặc null',
      );
  });
  (doc.schedules ?? []).forEach((s, i) => {
    const p = `/schedules/${i}`;
    const tz = s.tzOffsetMin ?? null;
    if (tz !== null && (!isInt(tz) || tz < -720 || tz > 840))
      err('E_LOGIC_SCHEDULE', `${p}/tzOffsetMin`, 'tzOffsetMin: -720 đến 840');
    if (s.weekly.length > LOGIC_LIMITS.windows)
      err('E_LOGIC_LIMIT', `${p}/weekly`, `${s.weekly.length} khung > ${LOGIC_LIMITS.windows}`);
    s.weekly.forEach((w, j) => {
      const q = `${p}/weekly/${j}`;
      const days = new Set<number>();
      if (w.days.length === 0) err('E_LOGIC_SCHEDULE', `${q}/days`, 'days rỗng');
      for (const d of w.days) {
        if (!isInt(d) || d < 1 || d > 7 || days.has(d)) {
          err(
            'E_LOGIC_SCHEDULE',
            `${q}/days`,
            `ngày ${d} lạ hoặc trùng (1 là thứ Hai … 7 là Chủ nhật)`,
          );
          break;
        }
        days.add(d);
      }
      const okFrom = HHMM_RE.test(w.from);
      const okTo = HHMM_RE.test(w.to);
      if (!okFrom) err('E_LOGIC_SCHEDULE', `${q}/from`, `from '${w.from}' không phải HH:MM`);
      if (!okTo) err('E_LOGIC_SCHEDULE', `${q}/to`, `to '${w.to}' không phải HH:MM`);
      if (okFrom && okTo && w.from === w.to) err('E_LOGIC_SCHEDULE', q, 'from = to');
    });
    const ex = s.exceptions ?? [];
    if (ex.length > LOGIC_LIMITS.exceptions)
      err('E_LOGIC_LIMIT', `${p}/exceptions`, `${ex.length} ngoại lệ > ${LOGIC_LIMITS.exceptions}`);
    const dates = new Set<string>();
    ex.forEach((x, j) => {
      const q = `${p}/exceptions/${j}`;
      if (!validDate(x.date)) err('E_LOGIC_SCHEDULE', `${q}/date`, `ngày '${x.date}' không hợp lệ`);
      else if (dates.has(x.date)) err('E_LOGIC_SCHEDULE', `${q}/date`, `ngày '${x.date}' trùng`);
      dates.add(x.date);
      if (x.mode !== 'on' && x.mode !== 'off')
        err('E_LOGIC_SCHEDULE', `${q}/mode`, `mode '${x.mode}' lạ (on, off)`);
    });
  });

  // 6. vòng và tự kích
  const { cycles, deps } = logicGraph(doc, env, outputs);
  const where = new Map<string, string>();
  for (const kind of LOGIC_BLOCK_KINDS)
    blocksOf(doc, kind).forEach((b, i) => {
      if (!where.has(b.id)) where.set(b.id, `/${kind}/${i}`);
    });
  for (const comp of cycles) {
    // đường đi ngắn nhất (BFS, láng giềng theo id) từ khối nhỏ nhất theo cạnh "đọc" quay về chính nó
    const start = comp[0]!;
    const inComp = new Set(comp);
    const prev = new Map<string, string>();
    const queue = [start];
    let path: string[] = [start, start];
    search: while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of deps.get(cur) ?? []) {
        if (!inComp.has(d)) continue;
        if (d === start) {
          path = [start];
          for (let x = cur; x !== start; x = prev.get(x)!) path.splice(1, 0, x);
          path.push(start);
          break search;
        }
        if (!prev.has(d)) {
          prev.set(d, cur);
          queue.push(d);
        }
      }
    }
    err('E_LOGIC_CYCLE', where.get(start) ?? '', `vòng phụ thuộc: ${path.join(' → ')}`);
  }

  // đọc gián tiếp: Tag → các Tag mà nó phụ thuộc (đầu vào của khối tạo ra nó, biểu thức của Tag tính toán)
  const blockById = new Map<string, [LogicBlockKind, AnyBlock]>();
  for (const kind of LOGIC_BLOCK_KINDS)
    for (const b of blocksOf(doc, kind)) if (!blockById.has(b.id)) blockById.set(b.id, [kind, b]);
  const tagDeps = (tag: string): string[] => {
    const o = outputs.get(tag);
    if (o) {
      const [kind, b] = blockById.get(o.block)!;
      return logicExpressions(kind, b).flatMap(([, src, t]) => refsOf(src, t, env));
    }
    const t = tags.get(tag);
    if (t?.kind === 'calculated' && t.expression !== undefined)
      return refsOf(t.expression, t.type, env);
    return [];
  };
  (doc.rules ?? []).forEach((r, i) => {
    const sets = new Set<string>();
    for (const list of [r.onRise ?? [], r.onFall ?? []])
      for (const a of list)
        if ((a.do === 'setTag' || a.do === 'toggle') && typeof a.tag === 'string') sets.add(a.tag);
    if (sets.size === 0 || typeof r.when !== 'string') return;
    const seen = new Set<string>();
    const todo = refsOf(r.when, 'BOOL', env);
    let hit: string | undefined;
    while (todo.length > 0 && hit === undefined) {
      const tag = todo.pop()!;
      if (seen.has(tag)) continue;
      seen.add(tag);
      if (sets.has(tag)) hit = tag;
      else todo.push(...tagDeps(tag));
    }
    if (hit !== undefined)
      err(
        'E_LOGIC_SELF_TRIGGER',
        `/rules/${i}/when`,
        `luật '${r.id}' đọc '${hit}' do chính hành động của nó đặt`,
      );
  });

  // 7. cảnh báo
  const conflict = new Map<string, string>();
  (doc.rules ?? []).forEach((r, i) => {
    const p = `/rules/${i}`;
    if (r.enabled === false) warn('W_LOGIC_DISABLED', `${p}/enabled`, `luật '${r.id}' đang tắt`);
    const acts = [...(r.onRise ?? []), ...(r.onFall ?? [])];
    const writesPlc = acts.some((a) => a.do === 'write' || a.do === 'pulse');
    if ((r.hold ?? 0) === 0 && writesPlc && typeof r.when === 'string') {
      const noisy = refsOf(r.when, 'BOOL', env).find((id) => {
        const t = tags.get(id);
        return t?.kind === 'external' && numericType(t.type);
      });
      if (noisy !== undefined)
        warn(
          'W_LOGIC_NO_HOLD',
          `${p}/hold`,
          `hold = 0 trên luật ghi PLC từ Tag có thể nhiễu ('${noisy}')`,
        );
    }
    const when = typeof r.when === 'string' ? r.when.replace(/\s+/g, '') : '';
    for (const list of ['onRise', 'onFall'] as const)
      (r[list] ?? []).forEach((a, j) => {
        let tag: string | undefined;
        if (a.do === 'setTag') tag = a.tag;
        else if (a.do === 'write' || a.do === 'pulse') tag = writes.get(a.write ?? '')?.tag;
        if (tag === undefined || a.value === undefined) return;
        const key = `${list}\u0000${when}\u0000${tag}`;
        const val = JSON.stringify(a.value);
        const prev = conflict.get(key);
        if (prev === undefined) conflict.set(key, val);
        else if (prev !== val)
          warn(
            'W_LOGIC_WRITE_CONFLICT',
            `${p}/${list}/${j}`,
            `'${tag}' được ghi hai giá trị khác nhau cùng điều kiện`,
          );
      });
  });
  const retained =
    (doc.rules ?? []).length +
    (doc.counters ?? []).filter((c) => c.retain !== false).length +
    (doc.totalizers ?? []).filter((z) => z.retain !== false).length +
    (doc.runhours ?? []).filter((h) => h.retain !== false).length;
  const perDay = Math.floor(86400 / flushS);
  const bytesPerDay = (retained * 24 + 512 + 4096) * perDay;
  if (bytesPerDay > LOGIC_RETAIN_IO_LIMIT)
    warn(
      'W_LOGIC_RETAIN_IO',
      '',
      `ước tính retain ${(bytesPerDay / 1048576).toFixed(1)} MiB/ngày > 100 MiB (${retained} khối, flushS ${flushS})`,
    );
  if (opts.deviceWrites === 'off' && (doc.writes ?? []).length > 0)
    warn(
      'W_LOGIC_WRITES_OFF',
      '/writes',
      'project có ghi PLC từ logic nhưng thiết bị đích đang tắt logic.writes',
    );

  return { errors, warnings };
}
