// Mô hình editor Bảng giá trị (feature 006, T187, FR-048, FR-046, data-model §3, contract value-tables-simulation §1): adapter
// lưới dùng chung (cùng chọn ô, bộ gõ, sao chép, dán, hoàn tác như Bảng Tag) với 3 cột Giá trị hoặc khoảng, Chữ, Màu và dòng
// mặc định ở cuối; cách viết giá trị và khoảng; lỗi theo ô (E_VT_OVERLAP, E_VT_RANGE, E_VT_TEXT, màu sai); ô thử (lookup).
// Hàm thuần, không DOM; luật của bảng lấy từ @mat/expression (cùng bộ với runtime).
import { VT_MAX_ENTRIES, VT_MAX_TEXT, lookupValueTable, validateValueTable } from '@mat/expression';
import type { ValueTableDoc, ValueTableEntry } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';

export { VT_MAX_ENTRIES };

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const SHORT_COLOR = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/;
const NUM = '[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const RE_NUM = new RegExp(`^${NUM}$`);
const RE_BRACKET = new RegExp(`^\\[\\s*(${NUM})?\\s*,\\s*(${NUM})?\\s*\\)$`);
const RE_DOTS = new RegExp(`^(${NUM})?\\s*\\.\\.\\s*(${NUM})?$`);
const RE_GE = new RegExp(`^>=\\s*(${NUM})$`);
const RE_LT = new RegExp(`^<\\s*(${NUM})$`);

/** Khóa của một mục: giá trị đơn hoặc khoảng nửa mở [from, to). */
export type EntryKey = { value: number | boolean } | { from?: number; to?: number };
export type KeyParse = { ok: true; key: EntryKey } | { ok: false };

const finite = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Viết khóa của mục: `0`, `true`, `[10, 20)`, `[10, )`, `[, 20)`. */
export function formatKey(e: ValueTableEntry): string {
  if (e.value !== undefined) return String(e.value);
  return `[${e.from ?? ''}, ${e.to ?? ''})`;
}

/** Đọc chữ người dùng gõ thành khóa: số, true/false, `[a, b)`, `a..b`, `>=a`, `<b`. */
export function parseKey(text: string): KeyParse {
  const s = text.trim();
  if (!s) return { ok: false };
  const lower = s.toLowerCase();
  if (lower === 'true') return { ok: true, key: { value: true } };
  if (lower === 'false') return { ok: true, key: { value: false } };
  if (RE_NUM.test(s)) {
    const n = finite(s);
    return n === undefined ? { ok: false } : { ok: true, key: { value: n } };
  }
  const range = (a: string | undefined, b: string | undefined): KeyParse => {
    const from = finite(a);
    const to = finite(b);
    if (from === undefined && to === undefined) return { ok: false };
    return {
      ok: true,
      key: { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) },
    };
  };
  let m = RE_BRACKET.exec(s) ?? RE_DOTS.exec(s);
  if (m) return range(m[1], m[2]);
  m = RE_GE.exec(s);
  if (m) return range(m[1], undefined);
  m = RE_LT.exec(s);
  if (m) return range(undefined, m[1]);
  return { ok: false };
}

/** Mục theo thứ tự khóa chuẩn: giá trị hoặc from/to, rồi chữ, rồi màu. */
function build(key: EntryKey, text: string, color: string | undefined): ValueTableEntry {
  return {
    ...key,
    text,
    ...(color !== undefined ? { color } : {}),
  } as ValueTableEntry;
}

function keyOf(e: ValueTableEntry): EntryKey {
  return e.value !== undefined
    ? { value: e.value }
    : {
        ...(e.from !== undefined ? { from: e.from } : {}),
        ...(e.to !== undefined ? { to: e.to } : {}),
      };
}

/** Màu `#RRGGBB` (giữ nguyên chữ hoa/thường); `#RGB` mở rộng; trống là bỏ màu (null); sai là undefined. */
function parseColor(text: string): string | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  if (COLOR.test(s)) return s;
  const m = SHORT_COLOR.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  return undefined;
}

export interface VtAdapterOptions {
  table: ValueTableDoc;
  readOnly: boolean;
}

export class ValueTableAdapter implements GridAdapter {
  readonly columns: readonly GridColumn[] = [
    { key: 'value', label: t('vt.col.key'), kind: 'text', width: 140, mono: true },
    { key: 'text', label: t('vt.col.text'), kind: 'text', width: 200 },
    { key: 'color', label: t('vt.col.color'), kind: 'color', width: 130, mono: true },
  ];
  readonly maxRows = VT_MAX_ENTRIES + 1;
  private readonly doc: ValueTableDoc;
  private readonly readOnly: boolean;

  constructor(opts: VtAdapterOptions) {
    this.doc = opts.table;
    this.readOnly = opts.readOnly;
  }

  private get n(): number {
    return this.doc.entries.length;
  }

  /** Chỉ số dòng của dòng mặc định (luôn ở cuối). */
  get defaultRow(): number {
    return this.n;
  }

  rowCount(): number {
    return this.n + 1;
  }

  text(row: number, col: string): string {
    if (row === this.n) {
      if (col === 'value') return t('vt.default');
      const d = this.doc.default;
      return col === 'text' ? (d?.text ?? '') : col === 'color' ? (d?.color ?? '') : '';
    }
    const e = this.doc.entries[row];
    if (!e) return '';
    if (col === 'value') return formatKey(e);
    if (col === 'text') return e.text ?? '';
    return e.color ?? '';
  }

  editable(row: number, col: string): boolean {
    if (this.readOnly) return false;
    return !(row === this.n && col === 'value');
  }

  searchText(row: number): string {
    return `${this.text(row, 'value')} ${this.text(row, 'text')} ${this.text(row, 'color')}`;
  }

  apply(changes: readonly CellChange[]): ApplyResult {
    const rejected: Rejected[] = [];
    const reject = (c: CellChange, reason: MessageKey): void =>
      void rejected.push({
        row: c.row,
        ...(c.newIndex !== undefined ? { newIndex: c.newIndex } : {}),
        col: c.col,
        text: c.text,
        reason,
      });
    const entries = this.doc.entries.map((e) => ({ ...e }));
    let def: { text?: string; color?: string } | undefined = this.doc.default
      ? { ...this.doc.default }
      : undefined;
    const fresh = new Map<
      number,
      { key?: EntryKey; text: string; color?: string; first: CellChange }
    >();

    const setText = (c: CellChange): string | null => {
      if ([...c.text].length > VT_MAX_TEXT) {
        reject(c, 'vt.err.textLen');
        return null;
      }
      return c.text;
    };

    for (const c of changes) {
      if (c.row === null) {
        const idx = c.newIndex ?? 0;
        const slot = fresh.get(idx) ?? { text: '', first: c };
        fresh.set(idx, slot);
        if (c.col === 'value') {
          const k = parseKey(c.text);
          if (!k.ok) reject(c, 'vt.err.key');
          else slot.key = k.key;
        } else if (c.col === 'text') {
          const v = setText(c);
          if (v !== null) slot.text = v;
        } else if (c.col === 'color') {
          const col = parseColor(c.text);
          if (col === undefined) reject(c, 'vt.err.color');
          else if (col !== null) slot.color = col;
        }
        continue;
      }
      if (c.row === this.n) {
        if (c.col === 'value') {
          reject(c, 'vt.err.defaultKey');
        } else if (c.col === 'text') {
          const v = setText(c);
          if (v !== null) {
            def = { ...(def ?? {}) };
            if (v === '') delete def.text;
            else def.text = v;
          }
        } else if (c.col === 'color') {
          const col = parseColor(c.text);
          if (col === undefined) reject(c, 'vt.err.color');
          else {
            def = { ...(def ?? {}) };
            if (col === null) delete def.color;
            else def.color = col;
          }
        }
        continue;
      }
      const e = entries[c.row];
      if (!e) {
        reject(c, 'vt.err.row');
        continue;
      }
      if (c.col === 'value') {
        const k = parseKey(c.text);
        if (!k.ok) reject(c, 'vt.err.key');
        else entries[c.row] = build(k.key, e.text, e.color);
      } else if (c.col === 'text') {
        const v = setText(c);
        if (v !== null) entries[c.row] = build(keyOf(e), v, e.color);
      } else if (c.col === 'color') {
        const col = parseColor(c.text);
        if (col === undefined) reject(c, 'vt.err.color');
        else entries[c.row] = build(keyOf(e), e.text, col ?? undefined);
      }
    }

    for (const [, slot] of [...fresh.entries()].sort((a, b) => a[0] - b[0])) {
      if (!slot.key) {
        // Đã có lỗi đọc giá trị ở ô của dòng này thì không báo thêm.
        if (
          !rejected.some(
            (r) => r.row === null && r.newIndex === slot.first.newIndex && r.col === 'value',
          )
        )
          reject(slot.first, 'vt.err.keyRequired');
        continue;
      }
      if (entries.length >= VT_MAX_ENTRIES) {
        reject(slot.first, 'vt.err.max');
        continue;
      }
      entries.push(build(slot.key, slot.text, slot.color));
    }

    if (def && Object.keys(def).length === 0) def = undefined;
    const next: ValueTableDoc = { ...this.doc, entries };
    if (def) next.default = def;
    else delete next.default;
    if (JSON.stringify(next) === JSON.stringify(this.doc)) return { edits: [], rejected };
    return { edits: [{ kind: 'valueTableUpsert', table: next }], rejected };
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    const drop = new Set(rows);
    const next: ValueTableDoc = {
      ...this.doc,
      entries: this.doc.entries.filter((_, i) => !drop.has(i)),
    };
    if (drop.has(this.n)) delete next.default;
    return [{ kind: 'valueTableUpsert', table: next }];
  }

  append(): { edits: ProjectEdit[]; row: number } {
    if (this.n >= VT_MAX_ENTRIES) return { edits: [], row: this.n };
    const used = new Set(
      this.doc.entries.flatMap((e) => (typeof e.value === 'number' ? [e.value] : [])),
    );
    let v = 0;
    while (used.has(v)) v++;
    const next: ValueTableDoc = {
      ...this.doc,
      entries: [...this.doc.entries, { value: v, text: '' }],
    };
    return { edits: [{ kind: 'valueTableUpsert', table: next }], row: this.n };
  }
}

export const valueTableAdapter = (opts: VtAdapterOptions): ValueTableAdapter =>
  new ValueTableAdapter(opts);

/** Lỗi theo ô của bảng (khóa `dòng:cột`): luật của runtime cộng màu sai. Dòng mặc định là dòng cuối. */
export function tableIssues(doc: ValueTableDoc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (k: string, text: string): void => void out.set(k, [...(out.get(k) ?? []), text]);
  const n = doc.entries.length;
  for (const i of validateValueTable(doc)) {
    const row = i.entry >= 0 ? i.entry : n;
    const col = i.code === 'E_VT_TEXT' ? 'text' : 'value';
    const rowCol = i.entry < 0 ? 'text' : col;
    if (i.code === 'E_VT_OVERLAP') {
      const m = /overlaps entry (\d+)/.exec(i.message);
      add(
        `${row}:${rowCol}`,
        m
          ? t('vt.issue.E_VT_OVERLAP', { other: t('vt.entryN', { n: Number(m[1]) + 1 }) })
          : t('vt.issue.E_VT_OVERLAP.plain'),
      );
    } else if (i.code === 'E_VT_RANGE') add(`${row}:${rowCol}`, t('vt.issue.E_VT_RANGE'));
    else if (i.code === 'E_VT_TEXT') add(`${row}:${rowCol}`, t('vt.issue.E_VT_TEXT'));
    else if (i.code === 'E_SCHEMA') add(`${row}:${rowCol}`, t('vt.issue.E_SCHEMA'));
    else add(`${row}:${rowCol}`, t('vt.issue.other', { code: i.code, message: i.message }));
  }
  doc.entries.forEach((e, i) => {
    if (e.color !== undefined && !COLOR.test(e.color))
      add(`${i}:color`, t('vt.issue.color', { color: e.color }));
  });
  if (doc.default?.color !== undefined && !COLOR.test(doc.default.color))
    add(`${n}:color`, t('vt.issue.color', { color: doc.default.color }));
  return out;
}

export type TryResult =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'entry'; text: string; color: string | null; entry: number; label: string }
  | { kind: 'default'; text: string; color: string | null; label: string }
  | { kind: 'none'; text: string; color: null };

/** Ô thử (FR-048): gõ một giá trị, thấy chữ, màu và mục khớp; cùng hàm tra với runtime. */
export function tryLookup(doc: ValueTableDoc, input: string): TryResult {
  const s = input.trim();
  if (!s) return { kind: 'empty' };
  let x: number | boolean;
  if (s.toLowerCase() === 'true') x = true;
  else if (s.toLowerCase() === 'false') x = false;
  else if (RE_NUM.test(s) && Number.isFinite(Number(s))) x = Number(s);
  else return { kind: 'invalid' };
  const r = lookupValueTable(
    { name: doc.name, entries: doc.entries, ...(doc.default ? { default: doc.default } : {}) },
    x,
  );
  if (typeof r.entry === 'number')
    return {
      kind: 'entry',
      text: r.text,
      color: r.color,
      entry: r.entry,
      label: t('vt.entryN', { n: r.entry + 1 }),
    };
  if (r.entry === 'default')
    return { kind: 'default', text: r.text, color: r.color, label: t('vt.default') };
  return { kind: 'none', text: '', color: null };
}
