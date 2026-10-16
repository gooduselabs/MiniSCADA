// Transform thuần của binding (data-model.md): direct, discreteMap, linearScale, valueTable của 0.2
// (feature 006, contract project-format-0.2 §8) và rangeMap + đích mở rộng của 0.4 (feature 008,
// contract binding-animation.md); quy tắc chất lượng xấu; chuẩn hóa giá trị theo đích. Không đụng DOM.
import { lookupValueTable, type ValueTable } from '@mat/expression';
import type { Binding, Binding02, Scalar, Transform } from '@mat/project-schema';
import type { Binding04, Transform04 } from './types04.ts';

export type TagValue = boolean | number | string | null;
export type Quality = 'GOOD' | 'BAD' | 'UNCERTAIN' | 'STALE';

/** Giá trị đã chuẩn hóa cho đích, hoặc `hold` = giữ nguyên hiển thị hiện tại. */
export type Output = { hold: true; value?: undefined } | { hold: false; value: string | number };

export const NEUTRAL_COLOR = '#8d99a3';
const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-zA-Z]{3,20})$/;
/** Tốc độ quay hiển thị tối đa (vòng/giây): 1450 rpm thật quá nhanh để mắt thấy. */
const MAX_VISUAL_RPS = 2;
const BOOL_SPIN_RPM = 600; // BOOL "chạy" → 1 vòng/giây
const DEFAULT_FLOW_SPEED = 60; // đơn vị/giây khi BOOL true và binding không khai `speed`
const MAX_FLOW = 300;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

type RangeMap = Extract<Transform04, { kind: 'rangeMap' }>;

/** Nửa mở [from, to); `from` vắng = -inf, `to` vắng = +inf; chỉ cho số hữu hạn. */
function applyRangeMap(t: RangeMap, v: TagValue): { ok: true; value: Scalar } | { ok: false } {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
  const hit = t.ranges.find(
    (r) => (r.from === undefined || v >= r.from) && (r.to === undefined || v < r.to),
  );
  if (hit) return { ok: true, value: hit.value };
  return t.default !== undefined ? { ok: true, value: t.default } : { ok: false };
}

export function applyTransform(
  t: Transform | Transform04,
  v: TagValue,
): { ok: true; value: Scalar } | { ok: false } {
  if (v === null) return { ok: false };
  switch (t.kind) {
    case 'direct':
      return { ok: true, value: v };
    case 'discreteMap': {
      const hit = t.cases.find((c) => c.equals === v);
      if (hit) return { ok: true, value: hit.value };
      return t.default !== undefined ? { ok: true, value: t.default } : { ok: false };
    }
    case 'linearScale': {
      if (typeof v !== 'number' || !Number.isFinite(v) || t.inMax === t.inMin) return { ok: false };
      const out = t.outMin + ((v - t.inMin) / (t.inMax - t.inMin)) * (t.outMax - t.outMin);
      const lo = Math.min(t.outMin, t.outMax);
      const hi = Math.max(t.outMin, t.outMax);
      const value = t.clamp === false ? out : Math.min(hi, Math.max(lo, out));
      return { ok: true, value: Math.round(value * 1e9) / 1e9 };
    }
    default:
      if ((t as { kind: string }).kind === 'rangeMap') return applyRangeMap(t as RangeMap, v);
      // format, expression chưa hỗ trợ (biểu thức trong binding thuộc GĐ sau): như lỗi.
      return { ok: false };
  }
}

/** Mặc định khi chất lượng xấu và binding không khai báo onBadQuality. */
function neutral(b: Binding04): Output {
  switch (b.target) {
    case 'style.fill':
    case 'style.stroke':
      return { hold: false, value: NEUTRAL_COLOR };
    case 'style.opacity':
      return { hold: false, value: 0.5 };
    case 'text.content':
      return { hold: false, value: '--' };
    case 'transform.rotate':
      return b.animation === 'spin' ? { hold: false, value: 0 } : { hold: true };
    case 'effect.blink':
    case 'effect.flow':
      return { hold: false, value: 0 }; // tắt / dừng
    default:
      return { hold: true };
  }
}

function formatText(b: Binding04, v: Scalar, unit: string | undefined): string {
  const f = b.format;
  const body =
    typeof v === 'number' && f?.decimals !== undefined ? v.toFixed(f.decimals) : String(v);
  const tail = f?.suffix ?? (f?.unitFromTag && unit ? ` ${unit}` : '');
  return (f?.prefix ?? '') + body + tail;
}

/** Chuẩn hóa theo đích; null = giá trị không dùng được cho đích này. */
function normalize(b: Binding04, v: Scalar, unit?: string): string | number | null {
  const num = typeof v === 'number' && Number.isFinite(v) ? v : null;
  switch (b.target) {
    case 'style.fill':
    case 'style.stroke':
      // chuỗi rỗng = giữ màu gốc (contract §2)
      return typeof v === 'string' && (v === '' || COLOR.test(v)) ? v : null;
    case 'style.opacity':
      return num === null ? null : clamp(num, 0, 1);
    case 'style.visibility':
      if (typeof v === 'boolean') return v ? 'visible' : 'hidden';
      return v === 'visible' || v === 'hidden' ? v : null;
    case 'text.content':
      return formatText(b, v, unit);
    case 'transform.rotate':
      if (b.animation === 'spin') {
        if (typeof v === 'boolean') return v ? BOOL_SPIN_RPM : 0;
        return num === null ? null : Math.max(0, num);
      }
      return num;
    case 'geometry.levelPercent':
    case 'geometry.clipLevel':
      return num === null ? null : clamp(num, 0, 100);
    case 'transform.translateX':
    case 'transform.translateY':
      return num === null ? null : clamp(num, -100000, 100000);
    case 'transform.scale':
      return num === null ? null : clamp(num, 0.01, 10);
    case 'effect.blink':
      if (typeof v === 'boolean') return v ? 1 : 0;
      return num === null ? null : num !== 0 ? 1 : 0;
    case 'effect.flow': {
      // Đầu ra = tốc độ (đơn vị/giây); âm chỉ khi byValueSign (chiều do dấu).
      if (typeof v === 'boolean') return v ? clamp(b.speed ?? DEFAULT_FLOW_SPEED, 0, MAX_FLOW) : 0;
      if (num === null) return null;
      const mag = Math.min(MAX_FLOW, Math.abs(num));
      return b.byValueSign && num < 0 ? -mag : mag;
    }
    default:
      return null;
  }
}

function bad(b: Binding04, unit?: string): Output {
  const ob = b.onBadQuality;
  if (ob?.mode === 'hold') return { hold: true };
  if (ob?.mode === 'override' && ob.value !== undefined) {
    // Chữ thay thế hiển thị nguyên văn (không thêm định dạng/hậu tố của giá trị số).
    const v = b.target === 'text.content' ? String(ob.value) : normalize(b, ob.value, unit);
    return v === null ? { hold: true } : { hold: false, value: v };
  }
  return neutral(b);
}

/** Bảng giá trị cho transform `valueTable`: do `valueTables` của GET /api/v1/projects/active cấp. */
export interface TableContext {
  /** Bảng của project theo tên (chỉ bảng binding dùng tới). */
  tables?: Readonly<Record<string, ValueTable>>;
  /** Tên bảng của Tag nguồn (`valueTable` trong tags.json), dùng khi binding không có `table`. */
  tagTable?: string;
  /** Đơn vị của Tag nguồn, cho `format.unitFromTag` (0.4). */
  unit?: string;
}

/** Chữ hoặc màu theo bảng; chuỗi rỗng cho màu nghĩa là không áp màu (phần tử giữ màu gốc). */
function evaluateTable(
  b: Binding04,
  t: { table?: string; output: 'text' | 'color' },
  v: TagValue,
  q: Quality,
  ctx: TableContext | undefined,
): Output {
  if (q !== 'GOOD' || v === null) return bad(b, ctx?.unit);
  const name = t.table ?? ctx?.tagTable;
  const table = name === undefined ? undefined : ctx?.tables?.[name];
  if (!table || (typeof v !== 'number' && typeof v !== 'boolean')) return bad(b, ctx?.unit);
  const r = lookupValueTable(table, v);
  if (t.output === 'text') return { hold: false, value: r.text };
  return { hold: false, value: r.color !== null && COLOR.test(r.color) ? r.color : '' };
}

export function evaluateBinding(
  b: Binding | Binding02 | Binding04,
  v: TagValue,
  q: Quality,
  ctx?: TableContext,
): Output {
  const b4 = b as unknown as Binding04;
  if (b4.transform.kind === 'valueTable') return evaluateTable(b4, b4.transform, v, q, ctx);
  return evaluatePlain(b4, v, q, ctx?.unit);
}

/** Đích không dùng được giá trị sai kiểu thì giữ nguyên hiển thị (thay vì màu trung tính). */
const HOLD_ON_TYPE_MISMATCH: ReadonlySet<string> = new Set([
  'style.visibility',
  'geometry.levelPercent',
  'geometry.clipLevel',
  'transform.translateX',
  'transform.translateY',
  'transform.scale',
]);

function evaluatePlain(b: Binding04, v: TagValue, q: Quality, unit?: string): Output {
  if (q !== 'GOOD') return bad(b, unit);
  const r = applyTransform(b.transform, v);
  if (!r.ok) return bad(b, unit);
  const n = normalize(b, r.value, unit);
  if (n !== null) return { hold: false, value: n };
  // Giá trị sai kiểu cho đích: màu/opacity/text dùng mặc định trung tính; còn lại giữ nguyên.
  return HOLD_ON_TYPE_MISMATCH.has(b.target) ? { hold: true } : bad(b, unit);
}

/** rpm → vòng/giây hiển thị (giới hạn để mắt nhìn được). */
export function spinRps(rpm: number): number {
  if (!(rpm > 0)) return 0;
  return Math.min(MAX_VISUAL_RPS, rpm / 600);
}
