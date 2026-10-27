// Đăng ký phần tử `mat-w-*` theo bảng, chỉ khi chưa có (customElements.get). Thêm widget: thêm một dòng vào
// WIDGET_ELEMENTS (S3 thêm button, switch, setpoint, slider, select ở đây).
import { MatAlarmCount } from '../alarm/mat-alarm-count.ts';
import { MatAlarmList } from '../alarm/mat-alarm-list.ts';
import { MatWButton } from './button.ts';
import { MatBar } from './bar.ts';
import { MatCard } from './card.ts';
import { MatGauge } from './gauge.ts';
import { MatLabel } from './label.ts';
import { MatLamp } from './lamp.ts';
import { MatLevel } from './level.ts';
import { MatLine } from './line.ts';
import { MatPanel } from './panel.ts';
import { MatPie } from './pie.ts';
import { MatWSelect } from './select.ts';
import { MatWSetpoint } from './setpoint.ts';
import { MatWSlider } from './slider.ts';
import { MatWSwitch } from './switch.ts';
import { MatTagTable } from './tag-table.ts';
import { MatHistoryTrend } from './history-trend.ts';
import { MatHistoryTable } from './history-table.ts';
import { MatHistoryBar } from './history-bar.ts';
import { MatHistoryPie } from './history-pie.ts';
import { MatStatTile } from './stat-tile.ts';
import { MatKpi } from './kpi.ts';
import { MatProgress } from './progress.ts';
import { MatStatusList } from './status-list.ts';
import { MatClock } from './clock.ts';
import { MatText } from './text.ts';
import { MatImage } from './image.ts';
import { MatWTimeRange } from './time-range.ts';

/** Loại widget (khóa `widget` của danh mục) → lớp phần tử. */
export const WIDGET_ELEMENTS: Record<string, CustomElementConstructor> = {
  card: MatCard,
  label: MatLabel,
  lamp: MatLamp,
  gauge: MatGauge,
  level: MatLevel,
  panel: MatPanel,
  line: MatLine,
  bar: MatBar,
  pie: MatPie,
  'tag-table': MatTagTable,
  button: MatWButton,
  switch: MatWSwitch,
  setpoint: MatWSetpoint,
  slider: MatWSlider,
  select: MatWSelect,
  // feature 009 (danh mục 0.4.0)
  'alarm-list': MatAlarmList,
  'alarm-count': MatAlarmCount,
  'history-trend': MatHistoryTrend,
  'history-table': MatHistoryTable,
  'history-bar': MatHistoryBar,
  'history-pie': MatHistoryPie,
  // feature 014 (danh mục 0.6.0): widget dashboard
  'stat-tile': MatStatTile,
  kpi: MatKpi,
  progress: MatProgress,
  'status-list': MatStatusList,
  clock: MatClock,
  text: MatText,
  image: MatImage,
  // feature 029 (danh mục 0.7.0): hẹn giờ Từ–Đến
  'time-range': MatWTimeRange,
};

export const tagNameOf = (widget: string): string => `mat-w-${widget}`;

/** Tên thẻ của loại widget đã có trong bảng; `undefined` khi loại không hỗ trợ. */
export function elementNameFor(widget: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(WIDGET_ELEMENTS, widget)
    ? tagNameOf(widget)
    : undefined;
}

/** Đăng ký mọi widget trong bảng (idempotent). */
export function registerWidgets(): void {
  for (const [type, ctor] of Object.entries(WIDGET_ELEMENTS)) {
    const name = tagNameOf(type);
    if (!customElements.get(name)) customElements.define(name, ctor);
  }
}
