// Feature 037: nhóm thuộc tính trong tab Hiển thị của bảng Thuộc tính (Dữ liệu / Hiển thị / Màu & biểu tượng / Ngưỡng &
// cảnh báo / Hành động) để người dùng tìm nhanh. Chỉ là cách trình bày của Studio: danh mục không đổi; thuộc tính chưa
// liệt kê rơi vào "Hiển thị".
export type PropSection = 'data' | 'look' | 'color' | 'threshold' | 'action';

export const SECTION_ORDER: readonly PropSection[] = [
  'data',
  'look',
  'color',
  'threshold',
  'action',
];

const BY_NAME: Readonly<Record<string, PropSection>> = {
  label: 'data',
  title: 'data',
  text: 'data',
  decimals: 'data',
  unit: 'data',
  min: 'data',
  max: 'data',
  goal: 'data',
  higherIsBetter: 'data',
  states: 'data',
  labels: 'data',
  kind: 'data',
  runValue: 'data',
  src: 'data',
  alt: 'data',
  useValueTable: 'data',
  invert: 'data',
  accent: 'color',
  accentColor: 'color',
  fill: 'color',
  icon: 'color',
  color: 'color',
  colors: 'color',
  valueColor: 'color',
  background: 'color',
  onColor: 'color',
  offColor: 'color',
  activeColor: 'color',
  inactiveColor: 'color',
  warnAbove: 'threshold',
  warnBelow: 'threshold',
  alarmAbove: 'threshold',
  alarmBelow: 'threshold',
  blinkAbove: 'threshold',
  blinkBelow: 'threshold',
  blinkOn: 'threshold',
  blinkRed: 'threshold',
  zones: 'threshold',
  highLimit: 'threshold',
  lowLimit: 'threshold',
  faultValue: 'threshold',
  showButtons: 'action',
  startText: 'action',
  stopText: 'action',
};

export const sectionOf = (prop: string): PropSection => BY_NAME[prop] ?? 'look';

/** Chia danh sách thuộc tính theo nhóm, giữ thứ tự danh mục trong mỗi nhóm; bỏ nhóm rỗng. */
export function groupBySection<T extends { name: string }>(
  fields: readonly T[],
): Array<{ section: PropSection; fields: T[] }> {
  return SECTION_ORDER.map((section) => ({
    section,
    fields: fields.filter((f) => sectionOf(f.name) === section),
  })).filter((g) => g.fields.length > 0);
}
