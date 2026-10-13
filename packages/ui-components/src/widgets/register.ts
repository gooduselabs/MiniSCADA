// Đăng ký phần tử `mat-w-*` theo bảng, chỉ khi chưa có (customElements.get). Thêm widget: thêm một dòng vào
// WIDGET_ELEMENTS (S3 thêm button, switch, setpoint, slider, select ở đây).
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
