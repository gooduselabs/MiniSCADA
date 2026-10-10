// Transform thuần của binding v0 (data-model.md): direct, discreteMap, linearScale; quy tắc chất
// lượng xấu; chuẩn hóa giá trị theo đích. Không đụng DOM.
import type { Binding, Scalar, Transform } from '@mat/project-schema';

export type TagValue = boolean | number | string | null;
export type Quality = 'GOOD' | 'BAD' | 'UNCERTAIN' | 'STALE';

/** Giá trị đã chuẩn hóa cho đích, hoặc `hold` = giữ nguyên hiển thị hiện tại. */
export type Output = { hold: true; value?: undefined } | { hold: false; value: string | number };

export const NEUTRAL_COLOR = '#8d99a3';
const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|[a-zA-Z]{3,20})$/;
/** Tốc độ quay hiển thị tối đa (vòng/giây): 1450 rpm thật quá nhanh để mắt thấy. */
const MAX_VISUAL_RPS = 2;
const BOOL_SPIN_RPM = 600; // BOOL "chạy" → 1 vòng/giây

export function applyTransform(
  t: Transform,
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
  }
}

/** Mặc định khi chất lượng xấu và binding không khai báo onBadQuality. */
function neutral(b: Binding): Output {
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
    default:
      return { hold: true };
  }
}

function formatText(b: Binding, v: Scalar): string {
  if (typeof v === 'number' && b.format?.decimals !== undefined)
    return v.toFixed(b.format.decimals) + (b.format.suffix ?? '');
  return String(v) + (b.format?.suffix ?? '');
}

/** Chuẩn hóa theo đích; null = giá trị không dùng được cho đích này. */
function normalize(b: Binding, v: Scalar): string | number | null {
  const num = typeof v === 'number' && Number.isFinite(v) ? v : null;
  switch (b.target) {
    case 'style.fill':
    case 'style.stroke':
      return typeof v === 'string' && COLOR.test(v) ? v : null;
    case 'style.opacity':
      return num === null ? null : Math.min(1, Math.max(0, num));
    case 'style.visibility':
      if (typeof v === 'boolean') return v ? 'visible' : 'hidden';
      return v === 'visible' || v === 'hidden' ? v : null;
    case 'text.content':
      return formatText(b, v);
    case 'transform.rotate':
      if (b.animation === 'spin') {
        if (typeof v === 'boolean') return v ? BOOL_SPIN_RPM : 0;
        return num === null ? null : Math.max(0, num);
      }
      return num;
    case 'geometry.levelPercent':
      return num === null ? null : Math.min(100, Math.max(0, num));
    default:
      return null;
  }
}

function bad(b: Binding): Output {
  const ob = b.onBadQuality;
  if (ob?.mode === 'hold') return { hold: true };
  if (ob?.mode === 'override' && ob.value !== undefined) {
    // Chữ thay thế hiển thị nguyên văn (không thêm định dạng/hậu tố của giá trị số).
    const v = b.target === 'text.content' ? String(ob.value) : normalize(b, ob.value);
    return v === null ? { hold: true } : { hold: false, value: v };
  }
  return neutral(b);
}

export function evaluateBinding(b: Binding, v: TagValue, q: Quality): Output {
  if (q !== 'GOOD') return bad(b);
  const r = applyTransform(b.transform, v);
  if (!r.ok) return bad(b);
  const n = normalize(b, r.value);
  if (n !== null) return { hold: false, value: n };
  // Giá trị sai kiểu cho đích: màu/opacity/text dùng mặc định trung tính; còn lại giữ nguyên.
  return b.target === 'style.visibility' || b.target === 'geometry.levelPercent'
    ? { hold: true }
    : bad(b);
}

/** rpm → vòng/giây hiển thị (giới hạn để mắt nhìn được). */
export function spinRps(rpm: number): number {
  if (!(rpm > 0)) return 0;
  return Math.min(MAX_VISUAL_RPS, rpm / 600);
}
