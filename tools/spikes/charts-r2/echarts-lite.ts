// Spike R2 (feature 012, T037): gói ECharts tối thiểu nhập theo mô-đun. Vite tách thành một chunk riêng vì main.ts nạp
// tệp này bằng import(); kích thước chunk đó là con số cần đo (mục tiêu ≤ 350 KB gzip).
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, HeatmapChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

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
  CanvasRenderer,
]);

export { echarts };
