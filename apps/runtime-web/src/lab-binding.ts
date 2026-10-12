// Binding thử nghiệm: phần tử có `data-tag="SIM.Txxxx"` đổi màu/chữ theo giá trị Tag.
// Chỉ là mã dev của trang lab.html (đo fixture Sprint 0, không đóng gói lên thiết bị); binding của
// sản phẩm là @mat/binding-engine (FR-013, audit C-06).

const BAD_COLOR = '#8d99a3';

/** 0 → xanh lá, 100 → đỏ; chất lượng khác GOOD hoặc giá trị không hữu hạn → xám. */
export function valueToColor(value: number, quality: string): string {
  if (quality !== 'GOOD' || !Number.isFinite(value)) return BAD_COLOR;
  const v = Math.min(100, Math.max(0, value));
  return `hsl(${Math.round(120 - v * 1.2)} 62% 42%)`;
}

export function collectBindings(root: Element): Map<string, Element[]> {
  const map = new Map<string, Element[]>();
  for (const el of Array.from(root.querySelectorAll('[data-tag]'))) {
    const tag = el.getAttribute('data-tag')!;
    const list = map.get(tag);
    if (list) list.push(el);
    else map.set(tag, [el]);
  }
  return map;
}

export function applyValue(el: Element, value: number, quality: string): void {
  const style = (el as SVGElement).style;
  if (el.localName === 'text') {
    el.textContent = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '--';
    style.fill = quality === 'GOOD' ? '' : BAD_COLOR; // STALE/BAD: chữ xám, không giống dữ liệu sống
    return;
  }
  const color = valueToColor(value, quality);
  if (el.getAttribute('fill') === 'none') style.stroke = color;
  else style.fill = color;
  if (el.localName === 'use') style.color = color; // symbol dùng currentColor
}
