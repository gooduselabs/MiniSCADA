// Định dạng giá trị dùng chung (FR-032, research R12): số theo decimals với dấu chấm và không nhóm hàng nghìn,
// BOOL theo bảng hoặc Bật/Tắt, INT64 dạng chuỗi giữ nguyên, STRING nguyên văn, bảng giá trị qua @mat/expression.
import { lookupValueTable, type ValueTable } from '@mat/expression';
import { vi } from '../i18n/vi.ts';
import type { TagInfo, TagState } from '../host/types.ts';

export interface FormatOptions {
  decimals?: number;
  /** `undefined`: theo Tag; `null`: không đơn vị; chuỗi: ghi đè. */
  unit?: string | null;
  table?: ValueTable | null;
  /** [chữ khi tắt, chữ khi bật]. */
  boolWords?: [string, string];
}

export interface FormattedValue {
  text: string;
  color?: string;
  unit: string;
}

const INTEGER_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);

/** Làm tròn ra xa số không (như roundHalfAway của 006), không ra "-0". */
export function fixed(n: number, decimals: number): string {
  const d = Math.max(0, Math.min(6, Math.trunc(decimals)));
  const f = 10 ** d;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * f * (1 + Number.EPSILON))) / f;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

function unitOf(info: TagInfo | undefined, opt: FormatOptions): string {
  if (opt.unit === null) return '';
  if (opt.unit !== undefined) return opt.unit;
  return info?.unit ?? '';
}

export function formatValue(
  state: TagState,
  info: TagInfo | undefined,
  opt: FormatOptions = {},
): FormattedValue {
  const unit = unitOf(info, opt);
  const v = state.value;
  if (v === null || v === undefined)
    return { text: state.quality === 'UNKNOWN' ? vi.unknownValue : vi.noValue, unit };

  const isBoolTag = info?.type === 'BOOL';
  const isString = info?.type === 'STRING' || (info === undefined && typeof v === 'string');

  // Bảng giá trị: BOOL và số (kể cả INT64 dạng chuỗi nhỏ); STRING bỏ qua.
  if (opt.table && !isString) {
    const x = toLookup(v, isBoolTag);
    if (x !== null) {
      const hit = lookupValueTable(opt.table, x);
      if (hit.entry !== null) {
        const out: FormattedValue = { text: hit.text, unit };
        if (hit.color) out.color = hit.color;
        return out;
      }
    }
  }

  if (isBoolTag || typeof v === 'boolean') {
    const on =
      typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v === 'true' || v === '1';
    const [off, onText] = opt.boolWords ?? [vi.off, vi.on];
    return { text: on ? onText : off, unit };
  }

  if (typeof v === 'string') return { text: v, unit };

  if (!Number.isFinite(v)) return { text: vi.noValue, unit };
  const decimals = opt.decimals ?? (info && INTEGER_TYPES.has(info.type) ? 0 : undefined);
  return { text: decimals === undefined ? String(v) : fixed(v, decimals), unit };
}

function toLookup(v: boolean | number | string, boolTag: boolean): number | boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return boolTag ? v !== 0 : Number.isNaN(v) ? null : v;
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Giá trị số để vẽ (thang, kim): số, chuỗi số (INT64), BOOL 1/0; còn lại NaN. */
export function numberOf(v: TagState['value']): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}
