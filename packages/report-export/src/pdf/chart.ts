// Biểu đồ của báo cáo PDF (feature 012, FR-038, research R6): ECharts 6.1.0 chế độ SSR (`ssr: true`, không DOM),
// renderer SVG, xuất chuỗi bằng `renderToSVGString()` rồi nhúng bằng nút `svg` của pdfmake: nét và chữ là vector,
// không vỡ hạt khi phóng (SC-009). Chỉ nạp cùng pdf.ts (chunk PDF tải lười khi bấm xuất, ADR-033). Nhãn là chuỗi
// thuần, zrender vẽ thành <text>; không có tooltip, không có HTML.
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { formatNumber, type ReportTable } from '@mat/history-math';
import type { ReportPalette } from '../theme.ts';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer]);

/** Hàm cộng dồn theo kỳ: vẽ cột; hàm còn lại (trung bình, lớn/nhỏ nhất, đầu/cuối kỳ): vẽ đường. */
const BAR_FNS = new Set(['sum', 'delta', 'count']);
const MAX_SERIES = 4;

export interface ChartSpec {
  /** Chỉ số cột dữ liệu được vẽ (cùng đơn vị với cột đầu). */
  columns: number[];
  kind: 'bar' | 'line';
}

/**
 * Chọn cột và kiểu biểu đồ: các cột cùng đơn vị và cùng loại hàm (cộng dồn hay không) với cột đầu, tối đa 4; null khi
 * không đáng vẽ (dưới hai hàng hoặc không có số).
 */
export function chartSpec(t: ReportTable): ChartSpec | null {
  if (t.rows.length < 2 || t.columns.length === 0) return null;
  const first = t.columns[0]!;
  const bar = BAR_FNS.has(first.fn);
  const columns = t.columns
    .map((c, k) => ({ c, k }))
    .filter(({ c }) => c.unit === first.unit && BAR_FNS.has(c.fn) === bar)
    .slice(0, MAX_SERIES)
    .map(({ k }) => k);
  const hasNumber = t.rows.some((r) => columns.some((k) => r.cells[k] !== null));
  if (!hasNumber) return null;
  return { columns, kind: bar ? 'bar' : 'line' };
}

export interface ChartRender {
  width: number;
  height: number;
  palette: ReportPalette;
  /** Tên chuỗi (thường là tiêu đề cột), cùng thứ tự `spec.columns`. */
  names: string[];
  font: string;
}

/** Chuỗi SVG của biểu đồ (đơn vị 1 px = 1 pt khi nhúng cùng kích thước). */
export function chartSvg(t: ReportTable, spec: ChartSpec, o: ChartRender): string {
  const p = o.palette;
  const decimals = Math.max(0, ...spec.columns.map((k) => t.columns[k]!.decimals));
  const unit = t.columns[spec.columns[0]!]!.unit;
  const many = spec.columns.length > 1;
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: o.width,
    height: o.height,
  });
  try {
    chart.setOption({
      animation: false,
      color: p.chart,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: o.font, color: p.text, fontSize: 8 },
      legend: many
        ? {
            top: 0,
            left: 'center',
            itemWidth: 10,
            itemHeight: 6,
            textStyle: { fontFamily: o.font, color: p.text, fontSize: 8 },
          }
        : { show: false },
      // ECharts 6: outerBounds mặc định giữ nhãn trục trong khung (containLabel cần mô-đun cũ riêng).
      grid: { left: 8, right: 12, top: many ? 22 : 18, bottom: 4 },
      xAxis: {
        type: 'category',
        data: t.rows.map((r) => r.label),
        boundaryGap: spec.kind === 'bar',
        axisLine: { lineStyle: { color: p.border } },
        axisTick: { show: false },
        axisLabel: { color: p.muted, fontFamily: o.font, fontSize: 7, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: unit,
        scale: spec.kind === 'line',
        nameTextStyle: { color: p.muted, fontFamily: o.font, fontSize: 7, align: 'left' },
        axisLabel: {
          color: p.muted,
          fontFamily: o.font,
          fontSize: 7,
          formatter: (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : decimals),
        },
        splitLine: { lineStyle: { color: p.border, type: [3, 3] } },
      },
      series: spec.columns.map((k, i) => {
        const data = t.rows.map((r) => r.cells[k] ?? '-');
        return spec.kind === 'bar'
          ? {
              type: 'bar',
              name: o.names[i],
              data,
              barMaxWidth: 24,
              itemStyle: { borderRadius: [2, 2, 0, 0] },
            }
          : {
              type: 'line',
              name: o.names[i],
              data,
              showSymbol: t.rows.length <= 31,
              symbolSize: 3,
              lineStyle: { width: 1.5 },
              ...(many ? {} : { areaStyle: { color: p.chartSoft[0], opacity: 1 } }),
            };
      }),
    });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
