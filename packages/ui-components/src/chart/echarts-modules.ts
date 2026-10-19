// Gói ECharts tối thiểu (feature 012, research R2, spike T037): chỉ nạp qua import() trong echarts-lite.ts nên Vite tách
// thành chunk riêng, trang không có biểu đồ không tải. Thêm mô-đun ở đây làm chunk lớn lên: đo lại (T047, SC-006).
import { BarChart, GaugeChart, HeatmapChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { ChartInstance, EChartsLite } from './echarts-lite.ts';

echarts.use([
  BarChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  SVGRenderer,
]);

export const lib: EChartsLite = {
  init: (dom, opts) =>
    echarts.init(dom, null, { renderer: 'svg', ...opts }) as unknown as ChartInstance,
};
