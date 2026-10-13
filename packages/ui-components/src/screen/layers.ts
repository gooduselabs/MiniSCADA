// Thứ tự lớp và tập Tag của màn hình (ADR-013 điểm 1, research R10). Thuần.
import type { Item, ScreenModel } from '@mat/project-schema';

export interface Layer {
  item: Item;
  /** Vị trí trong mảng `items` (đầu mảng ở dưới cùng). */
  index: number;
}

/** Các item cần dựng, theo thứ tự mảng, bỏ `hidden`. */
export function layersOf(screen: ScreenModel): Layer[] {
  const out: Layer[] = [];
  screen.items.forEach((item, index) => {
    if (!item.hidden) out.push({ item, index });
  });
  return out;
}

/** Widget lịch sử (history-*) hỏi HistorySource, không đăng ký live và không tính vào giới hạn Tag của màn hình. */
export const isHistoryWidget = (widget: string): boolean => widget.startsWith('history-');

/** Tag của khe `tags` của một item widget (mảng phẳng); item `svg` không có. */
export function itemTagIds(item: Item): string[] {
  if (item.type !== 'widget' || !item.tags || isHistoryWidget(item.widget)) return [];
  const out: string[] = [];
  for (const v of Object.values(item.tags)) {
    if (Array.isArray(v)) out.push(...v);
    else if (typeof v === 'string') out.push(v);
  }
  return out;
}

/**
 * Hợp Tag của các màn hình (màn hình chính + popup), bỏ item `hidden`, khử trùng, giữ thứ tự xuất hiện.
 * `svgTags(screenId, itemId)` cấp Tag của binding một item `svg` (đã tải).
 */
export function collectTagIds(
  screens: ReadonlyArray<ScreenModel | null | undefined>,
  svgTags?: (screenId: string, itemId: string) => readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const s of screens) {
    if (!s) continue;
    for (const { item } of layersOf(s)) {
      const ids = item.type === 'svg' ? (svgTags?.(s.id, item.id) ?? []) : itemTagIds(item);
      for (const id of ids) seen.add(id);
    }
  }
  return [...seen];
}
