// Trợ giúp gõ biểu thức của Tag tính toán (feature 006, T183, FR-049, SC-015, R22): gợi ý tên Tag (một phần tên, không phân
// biệt hoa thường), tên hàm kèm cú pháp, tên bảng giá trị trong text(; kiểm biểu thức (đúng span, có lý do tiếng Việt, vòng
// tham chiếu kèm đường vòng); xem trước kết quả với giá trị mô phỏng hoặc giá trị sống. Hàm thuần, không DOM. Phần tính
// chỉ dùng @mat/expression, cùng bộ biên dịch và bộ tính với runtime.
import {
  buildCalcGraph,
  compile,
  evaluate,
  tokens,
  type CalcInput,
  type ExprIssue,
  type InputValue,
  type Program,
  type TagDataType,
  type TokenKind,
  type ValueTable,
} from '@mat/expression';
import { reasonText } from '../app/code-text.ts';
import { fold, hasKey, t, type MessageKey } from '../i18n/index.ts';

/** Khoảng ngừng gõ trước khi kiểm (FR-049). */
export const CHECK_DELAY_MS = 200;
export const MAX_SUGGESTIONS = 8;

export interface AssistTag {
  id: string;
  type: TagDataType;
}

export interface AssistContext {
  /** Mọi Tag của project (kể cả Tag đang sửa). */
  tags: readonly AssistTag[];
  /** Tên các bảng giá trị. */
  tables: readonly string[];
  /** Kiểu của Tag tính toán nhận kết quả. */
  target: TagDataType;
  /** Id Tag tính toán đang sửa: không gợi ý chính nó; dùng để dò vòng tham chiếu. */
  self?: string;
  /** Các Tag tính toán khác và đầu vào của chúng (để dò vòng, độ sâu). */
  calcs?: readonly CalcInput[];
}

export interface FunctionInfo {
  name: string;
  /** Cú pháp (ký hiệu toán, không dịch). */
  syntax: string;
  /** Khóa chuỗi mô tả. */
  doc: MessageKey;
}

export const FUNCTIONS: readonly FunctionInfo[] = [
  { name: 'min', syntax: 'min(a, b, …)', doc: 'expr.fn.min' },
  { name: 'max', syntax: 'max(a, b, …)', doc: 'expr.fn.max' },
  { name: 'abs', syntax: 'abs(x)', doc: 'expr.fn.abs' },
  { name: 'round', syntax: 'round(x) | round(x, n)', doc: 'expr.fn.round' },
  { name: 'clamp', syntax: 'clamp(x, lo, hi)', doc: 'expr.fn.clamp' },
  { name: 'text', syntax: 'text(x, B)', doc: 'expr.fn.text' },
];

export type SuggestionKind = 'tag' | 'function' | 'table';

export interface Suggestion {
  kind: SuggestionKind;
  label: string;
  /** Chữ chèn thay cho `range`. */
  insert: string;
  detail: string;
  /** [đầu, cuối) trong biểu thức: từ đang gõ. */
  range: [number, number];
}

// ---------- Gợi ý ----------

const WORD = /[A-Za-z0-9_.]/;

/** Chỉ mục gợi ý dựng một lần cho một bộ Tag; mỗi phím chỉ quét một lượt qua tên đã chuẩn hóa. */
export class TagIndex {
  readonly tags: readonly AssistTag[];
  private readonly folded: readonly string[];
  readonly tables: readonly string[];
  private readonly foldedTables: readonly string[];

  constructor(ctx: Pick<AssistContext, 'tags' | 'tables' | 'self'>) {
    this.tags = ctx.tags.filter((x) => x.id !== ctx.self);
    this.folded = this.tags.map((x) => fold(x.id));
    this.tables = ctx.tables;
    this.foldedTables = ctx.tables.map(fold);
  }

  /** Tag khớp một phần tên: khớp đầu tên, rồi đầu một đoạn (sau . hoặc _), rồi khớp giữa. */
  matchTags(query: string, limit: number): AssistTag[] {
    const q = fold(query);
    if (!q) return [];
    const hits: { rank: number; at: number }[] = [];
    for (let i = 0; i < this.folded.length; i++) {
      const f = this.folded[i]!;
      const pos = f.indexOf(q);
      if (pos < 0) continue;
      const prev = pos > 0 ? f[pos - 1] : '';
      hits.push({ rank: pos === 0 ? 0 : prev === '.' || prev === '_' ? 1 : 2, at: i });
    }
    hits.sort((a, b) => a.rank - b.rank || a.at - b.at);
    return hits.slice(0, limit).map((h) => this.tags[h.at]!);
  }

  matchTables(query: string, limit: number): string[] {
    const q = fold(query);
    const out: string[] = [];
    for (let i = 0; i < this.foldedTables.length && out.length < limit; i++)
      if (this.foldedTables[i]!.includes(q)) out.push(this.tables[i]!);
    return out;
  }
}

/** `pos` có nằm trong chuỗi chữ "…" không (theo thoát \" và \\). */
function inString(src: string, pos: number): boolean {
  let open = false;
  for (let i = 0; i < pos; i++) {
    const c = src[i];
    if (open && c === '\\') i++;
    else if (c === '"') open = !open;
  }
  return open;
}

/** Đang ở tham số thứ hai của text(…)? (tham số là tên bảng giá trị). */
function inTableArgument(prefix: string): boolean {
  const stack: { fn: string; commas: number }[] = [];
  let lastFn = '';
  for (const tk of tokens(prefix)) {
    if (tk.kind === 'function') lastFn = tk.text;
    else if (tk.text === '(') {
      stack.push({ fn: lastFn, commas: 0 });
      lastFn = '';
    } else if (tk.text === ',') {
      const top = stack[stack.length - 1];
      if (top) top.commas++;
    } else if (tk.text === ')') stack.pop();
    else lastFn = '';
  }
  const top = stack[stack.length - 1];
  return top !== undefined && top.fn === 'text' && top.commas === 1;
}

/** Gợi ý cho từ đang gõ tại `caret`. Từ rỗng, số hay chuỗi chữ thì không gợi ý. */
export function suggest(
  index: TagIndex,
  src: string,
  caret: number,
  limit = MAX_SUGGESTIONS,
): Suggestion[] {
  let start = caret;
  while (start > 0 && WORD.test(src[start - 1]!)) start--;
  let end = caret;
  while (end < src.length && WORD.test(src[end]!)) end++;
  const word = src.slice(start, caret);
  if (!word || !/^[A-Za-z]/.test(word) || inString(src, start)) return [];
  const range: [number, number] = [start, end];

  if (inTableArgument(src.slice(0, start)))
    return index.matchTables(word, limit).map((name) => ({
      kind: 'table',
      label: name,
      insert: name,
      detail: t('expr.suggest.table'),
      range,
    }));

  const out: Suggestion[] = index.matchTags(word, limit).map((tg) => ({
    kind: 'tag',
    label: tg.id,
    insert: tg.id,
    detail: t('expr.suggest.tag', { type: tg.type }),
    range,
  }));
  const q = word.toLowerCase();
  if (!word.includes('.'))
    for (const f of FUNCTIONS)
      if (f.name.startsWith(q))
        out.push({
          kind: 'function',
          label: f.name,
          insert: `${f.name}(`,
          detail: `${f.syntax} — ${t(f.doc)}`,
          range,
        });
  return out.slice(0, limit);
}

// ---------- Kiểm ----------

export interface ExprProblem {
  code: string;
  /** [đầu, cuối) theo ký tự Unicode (code point) của biểu thức. */
  span: [number, number];
  /** Lý do bằng tiếng Việt. */
  message: string;
  /** Với E_EXPR_CYCLE: đường vòng, ví dụ ["A", "B", "A"]. */
  cycle?: string[];
}

export interface CheckResult {
  problem: ExprProblem | null;
  warnings: ExprProblem[];
  /** Id Tag đầu vào theo thứ tự xuất hiện đầu tiên (rỗng khi có lỗi). */
  inputs: string[];
  program: Program | null;
}

const snippet = (src: string, span: [number, number]): string => {
  const s = Array.from(src).slice(span[0], span[1]).join('');
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
};

function problemOf(src: string, issue: ExprIssue): ExprProblem {
  const code = issue.code;
  const text = snippet(src, issue.span);
  const key = `expr.err.${code}`;
  let message: string;
  if (code === 'E_EXPR_SYNTAX' && text === '') message = t('expr.err.E_EXPR_SYNTAX.end');
  else if (hasKey(key)) message = t(key, { text, path: '' });
  else message = t('expr.err.other', { code });
  return { code, span: issue.span, message };
}

/** Đường vòng quay để bắt đầu và kết thúc ở `self` (nếu `self` nằm trong vòng). */
function rotate(cycle: readonly string[], self: string): string[] {
  const ring = cycle.slice(0, -1);
  const at = ring.indexOf(self);
  if (at < 0) return [...cycle];
  const turned = [...ring.slice(at), ...ring.slice(0, at)];
  return [...turned, self];
}

export function checkExpression(src: string, ctx: AssistContext): CheckResult {
  const types = new Map<string, TagDataType>();
  for (const tg of ctx.tags) types.set(tg.id, tg.type);
  const tables = new Set(ctx.tables);
  const res = compile(src, {
    tagType: (id) => types.get(id),
    hasTable: (name) => tables.has(name),
    target: ctx.target,
  });
  if (!res.ok)
    return { problem: problemOf(src, res.errors[0]!), warnings: [], inputs: [], program: null };
  const len = Array.from(src).length;
  const warnings = res.warnings.map((w): ExprProblem => ({
    code: w.code,
    span: w.span,
    message: hasKey(`expr.warn.${w.code}`)
      ? t(`expr.warn.${w.code}` as MessageKey)
      : t('expr.err.other', { code: w.code }),
  }));
  const self = ctx.self;
  if (self !== undefined) {
    const calcs = [
      ...(ctx.calcs ?? []).filter((c) => c.id !== self),
      { id: self, inputs: res.inputs },
    ];
    const graph = buildCalcGraph(calcs);
    const mine = graph.issues.find((i) => i.id === self);
    if (mine) {
      const cycle = mine.cycle ? rotate(mine.cycle, self) : undefined;
      const problem: ExprProblem =
        mine.code === 'E_EXPR_CYCLE'
          ? {
              code: mine.code,
              span: [0, len],
              message: t('expr.err.E_EXPR_CYCLE', { text: '', path: (cycle ?? []).join(' → ') }),
              ...(cycle ? { cycle } : {}),
            }
          : {
              code: mine.code,
              span: [0, len],
              message: t('expr.err.E_EXPR_DEPTH', { text: '', path: '' }),
            };
      return { problem, warnings, inputs: res.inputs, program: null };
    }
  }
  return { problem: null, warnings, inputs: res.inputs, program: res.program };
}

/** Kiểm sau CHECK_DELAY_MS ngừng gõ: mỗi phím đặt lại hẹn giờ; `flush` kiểm ngay (rời ô, Enter). */
export class DebouncedCheck {
  private timer: unknown = null;
  private latest = '';
  private pending = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly run: (src: string) => void;
  private readonly delay: number;

  constructor(
    run: (src: string) => void,
    timers: {
      setTimer?: (fn: () => void, ms: number) => unknown;
      clearTimer?: (h: unknown) => void;
    } = {},
    delay = CHECK_DELAY_MS,
  ) {
    this.run = run;
    this.delay = delay;
    this.setTimer = timers.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      timers.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  input(src: string): void {
    this.latest = src;
    this.pending = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.fire();
    }, this.delay);
  }

  flush(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.fire();
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = false;
  }

  private fire(): void {
    if (!this.pending) return;
    this.pending = false;
    this.run(this.latest);
  }
}

// ---------- Xem trước ----------

export interface PreviewInput {
  id: string;
  /** Giá trị đã định dạng ("—" khi chưa có). */
  text: string;
  quality: InputValue['quality'];
  reason: string;
}

export type Preview =
  | {
      ok: true;
      /** Kết quả đã định dạng; null khi BAD (Tag giữ giá trị cuối). */
      value: string | null;
      quality: InputValue['quality'];
      /** Lý do tiếng Việt khi quality khác GOOD. */
      reason: string;
      inputs: PreviewInput[];
    }
  | { ok: false; problem: ExprProblem };

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 6,
  useGrouping: false,
});
const DASH = '—';

/** Giá trị để hiện trong xem trước: số theo cách viết Việt Nam, BOOL là TRUE/FALSE. */
export function formatValue(v: number | boolean | string | bigint | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return NUMBER_FORMAT.format(v);
  return String(v);
}

/** Nguồn giá trị của một Tag đầu vào; null: chưa có giá trị. */
export type InputSource = (id: string) => InputValue | null;

const NO_VALUE: InputValue = { value: null, quality: 'BAD', reason: 'NO_VALUE' };

/** Tính biểu thức với giá trị đầu vào (mô phỏng hoặc sống) bằng đúng bộ tính của runtime. */
export function previewExpression(
  src: string,
  ctx: AssistContext,
  source: InputSource,
  tables: readonly ValueTable[],
): Preview {
  const checked = checkExpression(src, ctx);
  if (checked.problem || !checked.program)
    return {
      ok: false,
      problem: checked.problem ?? {
        code: 'E_EXPR_SYNTAX',
        span: [0, 0],
        message: t('expr.empty'),
      },
    };
  const program = checked.program;
  const set = new Map<string, ValueTable>();
  for (const tb of tables) if (tb.name) set.set(tb.name, tb);
  const values = program.inputs.map((id) => source(id) ?? NO_VALUE);
  const r = evaluate(program, (i) => values[i]!, set);
  return {
    ok: true,
    value: r.value === undefined ? null : formatValue(r.value),
    quality: r.quality,
    reason: r.quality === 'GOOD' ? '' : reasonText(r.reason),
    inputs: program.inputs.map((id, i) => {
      const v = values[i]!;
      return {
        id,
        text: v.quality === 'BAD' && v.value === null ? DASH : formatValue(v.value),
        quality: v.quality,
        reason: v.quality === 'GOOD' ? '' : reasonText(v.reason),
      };
    }),
  };
}

// ---------- Tô màu cú pháp ----------

export interface HlSegment {
  text: string;
  kind: TokenKind | 'plain';
  /** Gạch dưới: đoạn nằm trong span của lỗi. */
  error: boolean;
}

/**
 * Chia biểu thức thành đoạn cùng loại token và cùng trạng thái lỗi (để vẽ lớp tô màu dưới ô nhập). Lỗi có span rỗng
 * (hết chuỗi) thì gạch ký tự cuối.
 */
export function highlight(src: string, error: readonly [number, number] | null): HlSegment[] {
  const cps = Array.from(src);
  if (cps.length === 0) return [];
  const kinds: (TokenKind | 'plain')[] = cps.map(() => 'plain');
  for (const tk of tokens(src)) for (let i = tk.span[0]; i < tk.span[1]; i++) kinds[i] = tk.kind;
  let [es, ee] = error ?? [0, 0];
  if (error && es === ee) {
    es = Math.min(es, cps.length - 1);
    ee = es + 1;
  }
  const out: HlSegment[] = [];
  cps.forEach((ch, i) => {
    const isErr = error !== null && i >= es && i < ee;
    const last = out[out.length - 1];
    if (last && last.kind === kinds[i] && last.error === isErr) last.text += ch;
    else out.push({ text: ch, kind: kinds[i]!, error: isErr });
  });
  return out;
}
