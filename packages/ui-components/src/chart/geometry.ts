// Hình học thuần cho gauge, level, cột và tròn (SVG tự viết, ADR-020). Góc theta: 0 là hướng lên, chiều kim đồng hồ.
import { safeColor } from '../format/color.ts';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vị trí giá trị trong thang, kẹp 0..1; NaN và thang suy biến cho 0. */
export function fraction(v: number, min: number, max: number): number {
  if (!Number.isFinite(v) || !(max > min)) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** Thang hiệu lực: thuộc tính, rồi giới hạn của Tag, rồi 0–100; thang suy biến (min ≥ max) dùng 0–100. */
export function resolveRange(
  propMin: unknown,
  propMax: unknown,
  tagMin: number | undefined,
  tagMax: number | undefined,
): { min: number; max: number } {
  const num = (x: unknown): number | undefined =>
    typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  const min = num(propMin) ?? tagMin ?? 0;
  const max = num(propMax) ?? tagMax ?? 100;
  return max > min ? { min, max } : { min: 0, max: 100 };
}

/** Góc kim đồng hồ nửa vòng: -90° (min) … +90° (max). */
export function gaugeAngle(f: number): number {
  return -90 + 180 * f;
}

export function polar(
  cx: number,
  cy: number,
  r: number,
  thetaDeg: number,
): { x: number; y: number } {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: r2(cx + r * Math.sin(t)), y: r2(cy - r * Math.cos(t)) };
}

/** Cung tròn từ theta0 đến theta1 (theo chiều kim đồng hồ), kể cả cả vòng (≥ 360°). */
export function arcPath(cx: number, cy: number, r: number, theta0: number, theta1: number): string {
  const span = theta1 - theta0;
  if (span >= 359.999) {
    const a = polar(cx, cy, r, theta0);
    const b = polar(cx, cy, r, theta0 + 180);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${b.x} ${b.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`;
  }
  const a = polar(cx, cy, r, theta0);
  const b = polar(cx, cy, r, theta1);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** Miếng bánh vành khuyên giữa hai bán kính (cho donut); rIn = 0 là miếng bánh đặc. */
export function sliceShape(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  theta0: number,
  theta1: number,
): string {
  const span = theta1 - theta0;
  if (span >= 359.999) {
    const outer = arcPath(cx, cy, rOut, theta0, theta0 + 360);
    return rIn > 0 ? `${outer} ${arcPath(cx, cy, rIn, theta0, theta0 + 360)}` : outer;
  }
  const o0 = polar(cx, cy, rOut, theta0);
  const o1 = polar(cx, cy, rOut, theta1);
  const large = span > 180 ? 1 : 0;
  if (rIn <= 0)
    return `M ${cx} ${cy} L ${o0.x} ${o0.y} A ${rOut} ${rOut} 0 ${large} 1 ${o1.x} ${o1.y} Z`;
  const i1 = polar(cx, cy, rIn, theta1);
  const i0 = polar(cx, cy, rIn, theta0);
  return `M ${o0.x} ${o0.y} A ${rOut} ${rOut} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${rIn} ${rIn} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
}

export interface ZoneSeg {
  from: number;
  to: number;
  color: string;
}

/** Vùng màu hợp lệ, cắt theo thang [min, max]; vùng sai màu hoặc nằm ngoài thang bị bỏ. */
export function zoneSegments(zones: unknown, min: number, max: number): ZoneSeg[] {
  if (!Array.isArray(zones)) return [];
  const out: ZoneSeg[] = [];
  for (const z of zones.slice(0, 4) as Array<Record<string, unknown>>) {
    if (typeof z !== 'object' || z === null) continue;
    const color = safeColor(z.color);
    const from = z.from;
    const to = z.to;
    if (!color || typeof from !== 'number' || typeof to !== 'number') continue;
    const a = Math.max(min, from);
    const b = Math.min(max, to);
    if (b > a) out.push({ from: a, to: b, color });
  }
  return out;
}

/** Màu của vùng chứa giá trị (nửa mở [from, to), vùng cuối gồm cả `to`). */
export function zoneColorAt(zones: readonly ZoneSeg[], v: number): string | undefined {
  for (const z of zones) if (v >= z.from && v < z.to) return z.color;
  const last = zones[zones.length - 1];
  return last && v === last.to ? last.color : undefined;
}

/**
 * Điểm dừng màu của cung đồng hồ ECharts (feature 012, axisLine.lineStyle.color): [phân số cuối đoạn, màu] tăng dần phủ
 * [0, 1]; đoạn không thuộc vùng nào là màu rãnh `track`. Vùng chồng nhau: vùng bắt đầu sau thắng phần còn lại.
 */
export function gaugeStops(
  zones: readonly ZoneSeg[],
  min: number,
  max: number,
  track: string,
): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let pos = 0;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  for (const z of [...zones].sort((a, b) => a.from - b.from)) {
    const f = r4(fraction(z.from, min, max));
    const g = r4(fraction(z.to, min, max));
    if (f > pos) out.push([f, track]);
    if (g > Math.max(pos, f)) out.push([g, z.color]);
    pos = Math.max(pos, f, g);
  }
  if (pos < 1) out.push([1, track]);
  return out;
}
