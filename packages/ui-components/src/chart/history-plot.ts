// Bộ dựng dữ liệu và bộ điều hợp uPlot cho biểu đồ lịch sử (feature 010, T083; contracts/widget-catalog-010.md §5).
// Phần thuần (alignSeries, niceTimeSplits, phóng/dịch, quy đổi tọa độ) không phụ thuộc DOM nên test được trong Node.
// uPlot chỉ vẽ (tải lười bằng import()); mọi tương tác (kéo chọn, cuộn, Shift+kéo, bàn phím) do widget xử lý.
import type { SeriesLine } from '../host/history-source.ts';

export interface TimeRange {
  from: number;
  to: number;
}

export interface AlignedData {
  /** ms UTC, tăng dần. */
  x: Float64Array;
  /** Giá trị mỗi đường theo `x`; NaN = đứt (null của API hoặc khoảng runtime không chạy). */
  y: Float64Array[];
  /** Vùng min–max (chỉ khi nguồn tổng hợp); null khi đường không có. */
  lo: (Float64Array | null)[];
  hi: (Float64Array | null)[];
}

export interface AlignOptions {
  /** Mỗi đường: true = bậc thang (giữ giá trị tới điểm kế), false = nội suy tuyến tính. */
  step: boolean[];
}

const NAN = Number.NaN;

/** Giá trị của một đường tại các điểm `xs` (xs tăng dần); NaN ngoài phạm vi, trong khoảng đứt hay cạnh ô null. */
function sample(
  t: readonly number[],
  v: ArrayLike<number | null>,
  xs: Float64Array,
  gaps: readonly [number, number][],
  step: boolean,
): Float64Array {
  const out = new Float64Array(xs.length).fill(NAN);
  let k = 0; // chỉ số điểm của đường có t[k] <= x (lớn nhất)
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    while (k + 1 < t.length && t[k + 1]! <= x) k++;
    if (t.length === 0 || t[k]! > x) continue; // trước điểm đầu
    const t0 = t[k]!;
    const v0 = v[k];
    if (t0 === x) {
      if (v0 !== null && v0 !== undefined && Number.isFinite(v0)) out[i] = v0;
      continue;
    }
    // x nằm sau điểm k: nếu có khoảng đứt chạm [t0, x] thì không nối
    let cut = false;
    for (const [a, b] of gaps) {
      if (a < x && b > t0) {
        cut = true;
        break;
      }
    }
    if (cut || v0 === null || v0 === undefined || !Number.isFinite(v0)) continue;
    if (step) {
      out[i] = v0;
      continue;
    }
    if (k + 1 >= t.length) continue; // sau điểm cuối: không kéo dài
    const t1 = t[k + 1]!;
    const v1 = v[k + 1];
    if (v1 === null || v1 === undefined || !Number.isFinite(v1)) continue;
    out[i] = v0 + ((v1 - v0) * (x - t0)) / (t1 - t0);
  }
  return out;
}

/** Ghép các đường về một trục thời gian chung và chèn điểm đứt tại biên khoảng runtime không chạy. */
export function alignSeries(
  lines: readonly SeriesLine[],
  gaps: readonly [number, number][],
  opt: AlignOptions,
): AlignedData {
  const set = new Set<number>();
  for (const l of lines) for (const t of l.t) set.add(t);
  if (set.size > 0) {
    const lo = Math.min(...set);
    const hi = Math.max(...set);
    for (const [a, b] of gaps) {
      if (a > lo && a < hi) set.add(a);
      if (b > lo && b < hi) set.add(b);
    }
  }
  const x = Float64Array.from([...set].sort((p, q) => p - q));
  const y: Float64Array[] = [];
  const lo: (Float64Array | null)[] = [];
  const hi: (Float64Array | null)[] = [];
  lines.forEach((l, i) => {
    const st = opt.step[i] ?? false;
    y.push(sample(l.t, l.v, x, gaps, st));
    lo.push(l.min && l.max ? sample(l.t, l.min, x, gaps, st) : null);
    hi.push(l.min && l.max ? sample(l.t, l.max!, x, gaps, st) : null);
  });
  // Trong khoảng đứt [a, b) mọi giá trị là NaN, kể cả điểm nằm đúng tại a hoặc giữa khoảng.
  for (const [a, b] of gaps) {
    for (let i = 0; i < x.length; i++) {
      const xi = x[i]!;
      if (xi >= a && xi < b) {
        for (const arr of [...y, ...lo, ...hi]) if (arr) arr[i] = NAN;
      }
    }
  }
  return { x, y, lo, hi };
}

/** Chỉ số điểm gần `t` nhất (hòa: điểm trước); -1 khi rỗng. */
export function nearestIndex(x: ArrayLike<number>, t: number): number {
  const n = x.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  // lo = chỉ số đầu tiên có x >= t
  if (lo === 0) return 0;
  return t - x[lo - 1]! <= x[lo]! - t ? lo - 1 : lo;
}

/** `±HH:MM` → ms. Chuỗi sai → 0. */
export function tzOffsetMs(tz: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!m) return 0;
  const ms = (Number(m[2]) * 60 + Number(m[3])) * 60_000;
  return m[1] === '-' ? -ms : ms;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const STEPS = [
  1000,
  2000,
  5000,
  10_000,
  15_000,
  30_000,
  MIN,
  2 * MIN,
  5 * MIN,
  10 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

/**
 * Vạch chia trục thời gian: bước "đẹp" gần nhất ≥ (khoảng / số vạch); vạch rơi vào bội số của bước theo giờ
 * ĐỊA PHƯƠNG của nhóm (`offsetMs`), không theo múi giờ trình duyệt. Trả ms UTC.
 */
export function niceTimeSplits(
  from: number,
  to: number,
  offsetMs: number,
  targetCount: number,
): number[] {
  if (!(to > from) || targetCount < 1) return [];
  const raw = (to - from) / targetCount;
  const step = STEPS.find((s) => s >= raw) ?? STEPS[STEPS.length - 1]!;
  const out: number[] = [];
  let t = Math.ceil((from + offsetMs) / step) * step - offsetMs;
  for (; t <= to; t += step) out.push(t);
  return out;
}

export const MIN_SPAN_MS = 1000;

/** Phóng (factor < 1) hoặc thu (factor > 1) quanh `anchor`, giữ nguyên vị trí tương đối của điểm neo. */
export function zoomRange(r: TimeRange, anchor: number, factor: number): TimeRange {
  const span = r.to - r.from;
  const next = Math.max(MIN_SPAN_MS, span * factor);
  const ratio = span > 0 ? (anchor - r.from) / span : 0.5;
  const from = anchor - ratio * next;
  return { from, to: from + next };
}

export function panRange(r: TimeRange, delta: number): TimeRange {
  return { from: r.from + delta, to: r.to + delta };
}

export function timeToPx(t: number, r: TimeRange, widthPx: number): number {
  const span = r.to - r.from;
  return span > 0 && widthPx > 0 ? ((t - r.from) / span) * widthPx : 0;
}

export function pxToTime(px: number, r: TimeRange, widthPx: number): number {
  return widthPx > 0 ? r.from + (px / widthPx) * (r.to - r.from) : 0;
}

// ---- bộ điều hợp uPlot (tải lười) -------------------------------------------------------------------------------

export interface HistoryPlotSeriesStyle {
  label: string;
  color: string;
  dash: number[];
  width: number;
  show: boolean;
  step: boolean;
  axis: 'left' | 'right';
}

export interface HistoryPlotOptions {
  width: number;
  height: number;
  series: HistoryPlotSeriesStyle[];
  grid: boolean;
  showBand: boolean;
  offsetMs: number;
  xRange: () => TimeRange;
  yRange: (scale: 'left' | 'right', min: number | null, max: number | null) => [number, number];
  xLabel: (ms: number, spanMs: number) => string;
  onCursor: (idx: number | null) => void;
  axisColor: string;
  gridColor: string;
  bandColors: string[];
}

export interface HistoryPlotAdapter {
  setData(d: AlignedData): void;
  setSize(width: number, height: number): void;
  /** Vẽ lại với khoảng X hiện hành của `xRange`. */
  redraw(): void;
  setSeriesShow(i: number, show: boolean): void;
  /** Hình chữ nhật vùng vẽ (px, tương đối so với host). */
  plotBox(): { left: number; top: number; width: number; height: number };
  destroy(): void;
}

export type HistoryPlotFactory = (
  host: HTMLElement,
  opts: HistoryPlotOptions,
  data: AlignedData,
) => HistoryPlotAdapter;

type UData = (number | null)[][];

/** Typed array → mảng thường với null tại NaN (uPlot chỉ ngắt nét ở null). */
function toUData(d: AlignedData, nSeries: number, band: boolean): UData {
  const nz = (a: Float64Array): (number | null)[] =>
    Array.from(a, (v) => (Number.isNaN(v) ? null : v));
  const out: UData = [Array.from(d.x, (v) => v / 1000)];
  for (let i = 0; i < nSeries; i++) out.push(nz(d.y[i] ?? new Float64Array(d.x.length).fill(NAN)));
  if (band) {
    for (let i = 0; i < nSeries; i++) {
      out.push(d.hi[i] ? nz(d.hi[i]!) : new Array(d.x.length).fill(null));
      out.push(d.lo[i] ? nz(d.lo[i]!) : new Array(d.x.length).fill(null));
    }
  }
  return out;
}

export async function loadHistoryPlot(): Promise<HistoryPlotFactory> {
  const mod = await import('uplot');
  const uPlot = mod.default;
  return (host, o, data) => {
    const n = o.series.length;
    const hasRight = o.series.some((s) => s.axis === 'right');
    const bandSeries = o.showBand
      ? o.series.flatMap((s, i) => [
          {
            label: `${s.label} max`,
            show: false,
            stroke: 'transparent',
            width: 0,
            points: { show: false },
            _i: i,
          },
          {
            label: `${s.label} min`,
            show: false,
            stroke: 'transparent',
            width: 0,
            points: { show: false },
            _i: i,
          },
        ])
      : [];
    const bands = o.showBand
      ? o.series.map((_s, i) => ({
          series: [1 + n + i * 2, 2 + n + i * 2] as [number, number],
          fill: o.bandColors[i % o.bandColors.length] ?? 'rgba(11,114,133,0.15)',
        }))
      : [];
    const u = new uPlot(
      {
        width: o.width,
        height: o.height,
        legend: { show: false },
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
        cursor: {
          drag: { x: false, y: false, setScale: false },
          points: { show: true },
          lock: false,
        },
        scales: {
          x: {
            time: true,
            range: () => {
              const r = o.xRange();
              return [r.from / 1000, r.to / 1000];
            },
          },
          y: {
            range: (_u, min, max) =>
              o.yRange(
                'left',
                Number.isFinite(min) ? min : null,
                Number.isFinite(max) ? max : null,
              ),
          },
          ...(hasRight
            ? {
                y2: {
                  range: (_u: unknown, min: number, max: number) =>
                    o.yRange(
                      'right',
                      Number.isFinite(min) ? min : null,
                      Number.isFinite(max) ? max : null,
                    ),
                },
              }
            : {}),
        },
        axes: [
          {
            stroke: o.axisColor,
            grid: { show: o.grid, stroke: o.gridColor, width: 1 },
            ticks: { stroke: o.gridColor, width: 1 },
            splits: (_u, _i, min, max) =>
              niceTimeSplits(min * 1000, max * 1000, o.offsetMs, 6).map((t) => t / 1000),
            values: (_u, splits) => {
              const span = splits.length > 1 ? (splits[splits.length - 1]! - splits[0]!) * 1000 : 0;
              return splits.map((s) => o.xLabel(s * 1000, span));
            },
          },
          {
            scale: 'y',
            stroke: o.axisColor,
            grid: { show: o.grid, stroke: o.gridColor, width: 1 },
            ticks: { stroke: o.gridColor, width: 1 },
          },
          ...(hasRight
            ? [
                {
                  scale: 'y2',
                  side: 1 as const,
                  stroke: o.axisColor,
                  grid: { show: false },
                  ticks: { stroke: o.gridColor, width: 1 },
                },
              ]
            : []),
        ],
        series: [
          {},
          ...o.series.map((s) => ({
            label: s.label,
            scale: s.axis === 'right' ? 'y2' : 'y',
            stroke: s.color,
            width: s.width,
            dash: s.dash.length ? s.dash : undefined,
            spanGaps: false,
            show: s.show,
            points: { show: false },
            paths: s.step ? uPlot.paths.stepped!({ align: 1 }) : undefined,
          })),
          ...bandSeries.map(({ _i, ...rest }) => ({
            ...rest,
            scale: o.series[_i]!.axis === 'right' ? 'y2' : 'y',
          })),
        ],
        bands,
        hooks: { setCursor: [(p) => o.onCursor(p.cursor.idx ?? null)] },
      },
      toUData(data, n, o.showBand) as unknown as import('uplot').AlignedData,
      host,
    );
    return {
      setData: (d) =>
        u.setData(toUData(d, n, o.showBand) as unknown as import('uplot').AlignedData, true),
      setSize: (width, height) => u.setSize({ width, height }),
      redraw: () => u.redraw(true, true),
      setSeriesShow: (i, show) => u.setSeries(i + 1, { show }),
      plotBox: () => ({
        left: u.bbox.left / devicePixelRatio,
        top: u.bbox.top / devicePixelRatio,
        width: u.bbox.width / devicePixelRatio,
        height: u.bbox.height / devicePixelRatio,
      }),
      destroy: () => u.destroy(),
    };
  };
}
