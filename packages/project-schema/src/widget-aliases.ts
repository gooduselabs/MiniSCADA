// Feature 037 (danh mục 0.8.0): gộp các loại widget trùng chức năng. Loại cũ vẫn có trong danh mục (đánh dấu
// `deprecated`) nên validator TS/C++ và runtime vẫn nhận và vẽ project cũ; Studio gọi các hàm ở đây khi mở project để
// chuyển item sang loại mới tương đương (một lần, người dùng lưu thì ghi đĩa).
import type { PropValue, WidgetItem } from './types-03.ts';

type Props = Record<string, PropValue>;

/** `stat-tile` (Thẻ chỉ số màu) → `card` kiểu nền đặc: giữ màu, biểu tượng, dòng trạng thái, khe Tag. */
function statTileToCard(it: WidgetItem): WidgetItem {
  const src: Props = { ...(it.props ?? {}) };
  const props: Props = { fill: 'solid', fontSize: 'l', statusText: true };
  const color = src['color'];
  delete src['color'];
  props['accent'] = typeof color === 'string' ? color : 'teal';
  for (const [k, v] of Object.entries(src)) props[k] = v;
  return { ...it, widget: 'card', props };
}

const ALIASES: Readonly<Record<string, (it: WidgetItem) => WidgetItem>> = {
  'stat-tile': statTileToCard,
};

/** Loại widget cũ có loại thay thế. */
export const isLegacyWidget = (widget: string): boolean =>
  Object.prototype.hasOwnProperty.call(ALIASES, widget);

/** Item sau khi chuyển; item không phải loại cũ trả nguyên (cùng tham chiếu). */
export function upgradeLegacyItem<T extends { type: string }>(it: T): T {
  if (it.type !== 'widget') return it;
  const w = it as unknown as WidgetItem;
  const f = ALIASES[w.widget];
  return f ? (f(w) as unknown as T) : it;
}

/**
 * Chuyển mọi item loại cũ của một màn hình (đối tượng JSON đã đọc). Trả `null` khi không có gì đổi để bên gọi giữ
 * nguyên tài liệu (không làm project "đã sửa").
 */
export function upgradeLegacyWidgets<S extends { items?: unknown }>(screen: S): S | null {
  if (!screen || !Array.isArray(screen.items)) return null;
  let changed = false;
  const items = (screen.items as Array<{ type: string }>).map((it) => {
    const n = it && typeof it === 'object' ? upgradeLegacyItem(it) : it;
    if (n !== it) changed = true;
    return n;
  });
  return changed ? { ...screen, items } : null;
}
