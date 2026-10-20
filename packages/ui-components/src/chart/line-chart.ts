// Bộ điều hợp uPlot cho biểu đồ đường (FR-029, ADR-020, research R11). uPlot chỉ vẽ: dữ liệu đã chuẩn bị bởi
// ChartWindow, tải lười bằng import() để không tính vào tải khởi động (SC-024). Widget chỉ biết `PlotFactory`,
// nên test thay bằng bộ điều hợp giả.

export interface PlotSeriesStyle {
  label: string;
  color: string;
  /** Mẫu nét (rỗng = liền): mỗi đường một kiểu để không chỉ phân biệt bằng màu. */
  dash: number[];
  width: number;
  show: boolean;
  /** Tô vùng dưới đường (rgba), feature 012: chỉ khi một đường. */
  fill?: string;
}

export interface PlotOptions {
  width: number;
  height: number;
  series: PlotSeriesStyle[];
  grid: boolean;
  /** Khoảng trục X (giây): cửa sổ cuối đến giờ nguồn. */
  xRange: () => [number, number];
  /** Khoảng trục Y từ dữ liệu: cố định hoặc tự co. */
  yRange: (dataMin: number | null, dataMax: number | null) => [number, number];
  /** Con trỏ đọc giá trị: chỉ số điểm gần nhất, hoặc null khi rời. */
  onCursor: (idx: number | null) => void;
  axisColor: string;
  gridColor: string;
  /** Phông chữ trục (--mat-font), feature 012. */
  font?: string;
  /** Màu bề mặt (--mat-surface): ruột điểm con trỏ, feature 012. */
  surfaceColor?: string;
  /** Đường ngưỡng ngang nét đứt (feature 014): ngưỡng cao, ngưỡng thấp. */
  limits?: PlotLimit[];
  /** Nhãn trục thời gian và trục giá trị (feature 014); rỗng là không có. */
  xLabel?: string;
  yLabel?: string;
}

export interface PlotLimit {
  kind: 'high' | 'low';
  value: number;
  color: string;
}

/** Khoảng dữ liệu nới để gồm cả các ngưỡng (đường ngưỡng luôn nằm trong khung khi trục Y tự co). */
export function rangeWithLimits(
  dataMin: number | null,
  dataMax: number | null,
  limits: readonly number[],
): [number | null, number | null] {
  const vals = [dataMin, dataMax, ...limits].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : [null, null];
}

export interface PlotAdapter {
  setData(data: Float64Array[]): void;
  setSize(width: number, height: number): void;
  destroy(): void;
}

export type PlotFactory = (
  host: HTMLElement,
  opts: PlotOptions,
  data: Float64Array[],
) => PlotAdapter;

/** Mẫu nét cho tối đa 12 đường (8 mẫu cũ giữ nguyên thứ tự). */
export const SERIES_DASHES: number[][] = [
  [],
  [10, 4],
  [2, 3],
  [10, 3, 2, 3],
  [16, 5],
  [4, 4],
  [1, 3],
  [8, 3, 2, 3, 2, 3],
  [12, 3, 3, 3],
  [6, 2],
  [3, 6],
  [14, 3, 2, 3, 2, 3],
];

/** Màu dự phòng khi token --mat-chart-N chưa có (jsdom, trang chưa nạp token): 12 màu của chủ đề industrial. */
export const FALLBACK_SERIES_COLORS = [
  '#0b7285',
  '#c2410c',
  '#6f42c1',
  '#15703a',
  '#b4234a',
  '#1c64c4',
  '#8f5e00',
  '#56646a',
  '#3a5bc7',
  '#815e46',
  '#953ea3',
  '#5c7c2f',
];

// ---- giao diện uPlot dùng chung (feature 012, T045): line và history-trend ----

export interface AxisStyle {
  stroke: string;
  font?: string;
  grid: { show: boolean; stroke: string; width: number; dash: number[] };
  ticks: { show: boolean; stroke: string; width: number };
}

/** Trục: chữ màu phụ theo phông token, không vạch chia, lưới nét đứt mảnh. */
export function axisStyle(o: {
  axisColor: string;
  gridColor: string;
  grid: boolean;
  font?: string;
}): AxisStyle {
  return {
    stroke: o.axisColor,
    ...(o.font ? { font: `11px ${o.font}` } : {}),
    grid: { show: o.grid, stroke: o.gridColor, width: 1, dash: [3, 3] },
    ticks: { show: false, stroke: o.gridColor, width: 1 },
  };
}

/** Điểm con trỏ: viền màu đường (chỉ số series uPlot, 0 là trục x), ruột màu bề mặt. */
export function cursorPoints(colors: readonly string[], surface: string) {
  return {
    show: true,
    size: 8,
    width: 2,
    stroke: (_u: unknown, i: number): string => colors[i - 1] ?? colors[0] ?? '#000000',
    fill: ((): string => surface) as (u: unknown, i: number) => string,
  };
}

/** rgba(r, g, b, a) từ #rrggbb; màu khác thì undefined (không tô). */
export function areaFill(hex: string, alpha: number): string | undefined {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return undefined;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Vùng tô nhạt dưới đường chỉ khi đúng một đường hiện (nhiều đường thì tô làm rối). */
export function singleSeriesFill(
  series: ReadonlyArray<{ color: string; show: boolean }>,
): Array<string | undefined> {
  const one = series.filter((s) => s.show).length === 1;
  return series.map((s) => (one && s.show ? areaFill(s.color, 0.12) : undefined));
}

/** Trục Y: cố định khi đặt cả hai, nếu không tự co theo dữ liệu thêm 5 % mỗi phía. */
export function autoYRange(
  dataMin: number | null,
  dataMax: number | null,
  yMin: number | undefined,
  yMax: number | undefined,
): [number, number] {
  if (typeof yMin === 'number' && typeof yMax === 'number' && yMax > yMin) return [yMin, yMax];
  if (
    dataMin === null ||
    dataMax === null ||
    !Number.isFinite(dataMin) ||
    !Number.isFinite(dataMax)
  )
    return [0, 1];
  if (dataMax === dataMin) {
    const pad = Math.abs(dataMin) * 0.05 || 1;
    return [dataMin - pad, dataMax + pad];
  }
  const pad = (dataMax - dataMin) * 0.05;
  return [dataMin - pad, dataMax + pad];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Nhãn trục thời gian (giây epoch, giờ địa phương) kiểu 24 giờ: HH:mm, HH:mm:ss khi có vạch lẻ giây; vạch đầu và vạch
 * sang ngày mới kèm dd/MM khi các vạch trải qua nhiều ngày. Thay nhãn mặc định của uPlot (kiểu Mỹ, "7:04am").
 */
export function clockLabels(splits: readonly number[]): string[] {
  const dates = splits.map((s) => (Number.isFinite(s) ? new Date(s * 1000) : null));
  const ok = dates.filter((d): d is Date => d !== null);
  const withSec = ok.some((d) => d.getSeconds() !== 0);
  const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const multiDay = new Set(ok.map(dayKey)).size > 1;
  let prevDay = '';
  return dates.map((d) => {
    if (!d) return '';
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSec ? `:${pad2(d.getSeconds())}` : ''}`;
    const key = dayKey(d);
    const showDay = multiDay && key !== prevDay;
    prevDay = key;
    return showDay ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${time}` : time;
  });
}

/** Nhãn trục của uPlot (feature 014); chuỗi rỗng là không có nhãn. */
function axisLabel(text: string | undefined, font?: string): Record<string, unknown> {
  return text ? { label: text, labelSize: 18, ...(font ? { labelFont: `11px ${font}` } : {}) } : {};
}

/** Vẽ đường ngưỡng ngang nét đứt trên canvas của uPlot (sau khi vẽ chuỗi). */
function drawLimits(u: import('uplot'), limits: readonly PlotLimit[]): void {
  if (!limits.length) return;
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  for (const l of limits) {
    const y = Math.round(u.valToPos(l.value, 'y', true)) + 0.5;
    if (!Number.isFinite(y)) continue;
    ctx.beginPath();
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Nạp uPlot (import lười) và trả nhà máy dựng đồ thị. */
export async function loadUPlot(): Promise<PlotFactory> {
  const mod = await import('uplot');
  const uPlot = mod.default;
  return (host, o, data) => {
    const u = new uPlot(
      {
        width: o.width,
        height: o.height,
        legend: { show: false },
        cursor: {
          drag: { x: false, y: false, setScale: false },
          points: cursorPoints(
            o.series.map((s) => s.color),
            o.surfaceColor ?? '#ffffff',
          ),
        },
        scales: {
          x: { time: true, range: () => o.xRange() },
          y: {
            range: (_u, min, max) =>
              o.yRange(Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null),
          },
        },
        axes: [
          {
            ...axisStyle(o),
            // "HH:mm:ss" rộng hơn nhãn mặc định: giãn vạch để chữ không chạm nhau.
            space: 80,
            values: (_u: unknown, splits: number[]) => clockLabels(splits),
            ...axisLabel(o.xLabel, o.font),
          },
          { ...axisStyle(o), ...axisLabel(o.yLabel, o.font) },
        ],
        series: [
          {},
          ...o.series.map((s) => ({
            label: s.label,
            stroke: s.color,
            width: s.width,
            dash: s.dash.length ? s.dash : undefined,
            spanGaps: false,
            show: s.show,
            points: { show: false },
            ...(s.fill ? { fill: s.fill } : {}),
          })),
        ],
        hooks: {
          setCursor: [(p) => o.onCursor(p.cursor.idx ?? null)],
          draw: [(p) => drawLimits(p, o.limits ?? [])],
        },
      },
      data as unknown as import('uplot').AlignedData,
      host,
    );
    return {
      setData: (d) => u.setData(d as unknown as import('uplot').AlignedData, true),
      setSize: (width, height) => u.setSize({ width, height }),
      destroy: () => u.destroy(),
    };
  };
}
