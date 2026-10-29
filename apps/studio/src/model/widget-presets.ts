// Feature 037: giá trị khởi đầu "đẹp ngay" khi thả một component mới (Toolbox → canvas hoặc ô lưới). Chỉ là thuộc tính
// thường của danh mục. Nguyên tắc (review 037): mặc định của danh mục = hành vi cũ (project cũ không tự đổi giao diện);
// giao diện mới đẹp chỉ đến từ đây, khi người dùng thả component mới. Phần còn lại: (người dùng sửa, xóa tự do); loại không có trong bảng thì `props` rỗng như trước. Chữ hiển thị
// (nhãn, tiêu đề, chữ trạng thái) lấy từ i18n (`preset.*`).
import type { PropValue } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';

type Props = Readonly<Record<string, PropValue>>;

/** Thuộc tính khởi đầu; chuỗi dạng `@preset.x` là khóa i18n, thay bằng chữ khi dùng. */
export const WIDGET_PRESETS: Readonly<Record<string, Props>> = {
  card: {
    label: '@preset.card',
    fill: 'soft',
    accent: 'blue',
    flash: true,
    fontSize: 'l',
    trend: true,
    sparkline: true,
  },
  lamp: { label: '@preset.lamp', glow: true },
  level: { label: '@preset.level', style: 'tank', wave: true },
  panel: { title: '@preset.panel', variant: 'header', accent: 'blue' },
  kpi: { label: '@preset.kpi' },
  progress: { label: '@preset.progress', shape: 'ring' },
  'multi-state': {
    label: '@preset.multi-state',
    states: [
      { value: 0, text: '@preset.state.stop', color: '#6f7f88' },
      { value: 1, text: '@preset.state.run', color: '#268426' },
      { value: 2, text: '@preset.state.fault', color: '#c84845', blink: true },
    ],
  },
  'stack-light': { label: '@preset.stack-light' },
  equipment: { label: '@preset.equipment', kind: 'pump' },
  button: { label: '@preset.button' },
  switch: { label: '@preset.switch' },
  setpoint: { label: '@preset.setpoint' },
  slider: { label: '@preset.slider' },
  line: { title: '@preset.line' },
  bar: { title: '@preset.bar' },
  pie: { title: '@preset.pie' },
  'tag-table': { title: '@preset.tag-table' },
  // Feature 041: bảng alarm mới thả vào là kiểu Đầy đủ (ô lưới hẹp < 8 cột: Gọn, xem grid-ops.attachWidget).
  'alarm-list': { mode: 'full' },
};

/**
 * Feature 041: mục Toolbox là preset của một loại có sẵn (cùng `widget`, không thêm loại mới). Id mục dạng `<loại>~<tên>`.
 */
export const TOOL_VARIANTS: Readonly<
  Record<string, { widget: string; label: MessageKey; desc: MessageKey; props: Props }>
> = {
  'alarm-list~history': {
    widget: 'alarm-list',
    label: 'widget.alarm-list~history',
    desc: 'wdesc.alarm-list~history',
    props: { mode: 'full', source: 'history' },
  },
};

/** Loại của danh mục cho id mục Toolbox (bỏ hậu tố preset). */
export const baseWidget = (id: string): string => TOOL_VARIANTS[id]?.widget ?? id;

function resolve(v: PropValue): PropValue {
  if (typeof v === 'string') return v.startsWith('@') ? t(v.slice(1) as MessageKey) : v;
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}

/** Bản sao sâu của thuộc tính khởi đầu với chữ đã dịch (`undefined` khi loại không có). */
export function presetProps(widget: string): Record<string, PropValue> | undefined {
  const v = TOOL_VARIANTS[widget];
  const p = v ? { ...(WIDGET_PRESETS[v.widget] ?? {}), ...v.props } : WIDGET_PRESETS[widget];
  return p ? (resolve(p) as Record<string, PropValue>) : undefined;
}
