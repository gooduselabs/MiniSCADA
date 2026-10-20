// Biểu đồ của báo cáo PDF (feature 012, FR-038, research R6; feature 015: vẽ từ `ReportTable.chart`, cùng dữ liệu với
// khung biểu đồ của `<mat-report-view>`): ECharts 6.1.0 chế độ SSR (`ssr: true`, không DOM), renderer SVG, xuất chuỗi
// bằng `renderToSVGString()` rồi nhúng bằng nút `svg` của pdfmake: nét và chữ là vector, không vỡ hạt khi phóng
// (SC-009). Chỉ nạp cùng pdf.ts (chunk PDF tải lười khi bấm xuất, ADR-033). Nhãn là chuỗi thuần, zrender vẽ thành
// <text>; không có tooltip, không có HTML.
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { formatNumber, reportChart, type ReportChart, type ReportTable } from '@mat/history-math';
import type { ReportPalette } from '../theme.ts';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer]);

/**
 * Biểu đồ của bảng: `t.chart` (feature 015; null = tắt) hoặc, với bảng không có trường đó, tự chọn như 012. Dưới hai
 * hàng thì không vẽ.
 */
export function chartOf(t: ReportTable, name: (k: number) => string): ReportChart | null {
  if (t.rows.length < 2) return null;
  if (t.chart !== undefined) return t.chart;
  return reportChart(t, undefined, (c) => name(t.columns.indexOf(c)));
}

export interface ChartRender {
  width: number;
  height: number;
  palette: ReportPalette;
  font: string;
}

/** Chuỗi SVG của biểu đồ (đơn vị 1 px = 1 pt khi nhúng cùng kích thước). */
export function chartSvg(c: ReportChart, o: ChartRender): string {
  const p = o.palette;
  const many = c.series.length > 1;
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
        data: c.categories,
        boundaryGap: c.kind === 'bar',
        axisLine: { lineStyle: { color: p.border } },
        axisTick: { show: false },
        axisLabel: { color: p.muted, fontFamily: o.font, fontSize: 7, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: c.unit,
        scale: c.kind === 'line',
        // số đếm (0 số lẻ): vạch chia nguyên
        ...(c.decimals === 0 ? { minInterval: 1 } : {}),
        nameTextStyle: { color: p.muted, fontFamily: o.font, fontSize: 7, align: 'left' },
        axisLabel: {
          color: p.muted,
          fontFamily: o.font,
          fontSize: 7,
          formatter: (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : c.decimals),
        },
        splitLine: { lineStyle: { color: p.border, type: [3, 3] } },
      },
      series: c.series.map((s) => {
        const data = s.values.map((v) => v ?? '-');
        return c.kind === 'bar'
          ? {
              type: 'bar',
              name: s.name,
              ...(c.stacked ? { stack: 'total' } : {}),
              data,
              barMaxWidth: 24,
              itemStyle: { borderRadius: [2, 2, 0, 0] },
            }
          : {
              type: 'line',
              name: s.name,
              data,
              showSymbol: c.categories.length <= 31,
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
