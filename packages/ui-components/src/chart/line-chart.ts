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

/** Mẫu nét cho tối đa 8 đường. */
export const SERIES_DASHES: number[][] = [
  [],
  [10, 4],
  [2, 3],
  [10, 3, 2, 3],
  [16, 5],
  [4, 4],
  [1, 3],
  [8, 3, 2, 3, 2, 3],
];

/** Màu dự phòng khi token --mat-chart-N chưa có (jsdom, trang chưa nạp token). */
export const FALLBACK_SERIES_COLORS = [
  '#0b7285',
  '#c2410c',
  '#6f42c1',
  '#15703a',
  '#b4234a',
  '#1c64c4',
  '#8f5e00',
  '#56646a',
];

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
        cursor: { drag: { x: false, y: false, setScale: false }, points: { show: true } },
        scales: {
          x: { time: true, range: () => o.xRange() },
          y: {
            range: (_u, min, max) =>
              o.yRange(Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null),
          },
        },
        axes: [
          {
            stroke: o.axisColor,
            grid: { show: o.grid, stroke: o.gridColor, width: 1 },
            ticks: { stroke: o.gridColor, width: 1 },
          },
          {
            stroke: o.axisColor,
            grid: { show: o.grid, stroke: o.gridColor, width: 1 },
            ticks: { stroke: o.gridColor, width: 1 },
          },
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
          })),
        ],
        hooks: {
          setCursor: [(p) => o.onCursor(p.cursor.idx ?? null)],
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
