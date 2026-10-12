// Bảng giá trị (contract value-tables-simulation §1): kiểm luật chồng, khoảng, độ dài chữ và tra.
import type { ExprIssue, LookupResult, ValueTable, VtEntry } from './types.ts';

export const VT_MAX_ENTRIES = 256;
export const VT_MAX_TEXT = 64;

interface Norm {
  from: number;
  to: number;
  /** true: điểm {from}; false: khoảng nửa mở [from, to). */
  point: boolean;
}

function normEntry(e: VtEntry): Norm {
  if (e.value !== undefined) {
    const v = typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value;
    return { from: v, to: v, point: true };
  }
  return { from: e.from ?? -Infinity, to: e.to ?? Infinity, point: false };
}

function overlap(a: Norm, b: Norm): boolean {
  if (a.point && b.point) return a.from === b.from;
  if (a.point) return b.from <= a.from && a.from < b.to;
  if (b.point) return a.from <= b.from && b.from < a.to;
  return Math.max(a.from, b.from) < Math.min(a.to, b.to);
}

/** Kiểm bảng. Mỗi lỗi mang chỉ số mục (hoặc -1 cho `default`) trong `entry`. */
export interface VtIssue extends Omit<ExprIssue, 'span'> {
  entry: number;
}

export function validateValueTable(table: ValueTable): VtIssue[] {
  const issues: VtIssue[] = [];
  const norm: (Norm | null)[] = [];
  table.entries.forEach((e, i) => {
    const hasValue = e.value !== undefined;
    const hasRange = e.from !== undefined || e.to !== undefined;
    if (hasValue === hasRange) {
      issues.push({ code: 'E_SCHEMA', message: 'entry needs value or from/to', entry: i });
      norm.push(null);
      return;
    }
    const n = normEntry(e);
    if (!n.point && !(n.from < n.to)) {
      issues.push({ code: 'E_VT_RANGE', message: 'empty range (from >= to)', entry: i });
      norm.push(null);
    } else norm.push(n);
    if ([...e.text].length > VT_MAX_TEXT)
      issues.push({ code: 'E_VT_TEXT', message: 'text longer than 64 characters', entry: i });
  });
  if (table.default?.text !== undefined && [...table.default.text].length > VT_MAX_TEXT)
    issues.push({
      code: 'E_VT_TEXT',
      message: 'default text longer than 64 characters',
      entry: -1,
    });
  for (let j = 1; j < norm.length; j++) {
    const b = norm[j];
    if (!b) continue;
    for (let i = 0; i < j; i++) {
      const a = norm[i];
      if (a && overlap(a, b)) {
        issues.push({ code: 'E_VT_OVERLAP', message: `entry ${j} overlaps entry ${i}`, entry: j });
        break;
      }
    }
  }
  return issues;
}

/** lookup(B, x): BOOL là 1/0; NaN và không khớp thì dùng default; không có default thì chữ rỗng. */
export function lookupValueTable(table: ValueTable, x: number | boolean): LookupResult {
  const v = typeof x === 'boolean' ? (x ? 1 : 0) : x;
  if (!Number.isNaN(v)) {
    for (let i = 0; i < table.entries.length; i++) {
      const e = table.entries[i]!;
      let hit: boolean;
      if (e.value !== undefined)
        hit = v === (typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value);
      else hit = (e.from === undefined || v >= e.from) && (e.to === undefined || v < e.to);
      if (hit) return { text: e.text, color: e.color ?? null, entry: i };
    }
  }
  if (table.default)
    return { text: table.default.text ?? '', color: table.default.color ?? null, entry: 'default' };
  return { text: '', color: null, entry: null };
}
