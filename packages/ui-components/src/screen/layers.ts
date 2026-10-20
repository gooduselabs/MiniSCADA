// Thứ tự lớp và tập Tag của màn hình (ADR-013 điểm 1, research R10). Thuần.
import { cellsOf, type GridScreen, type Item, type ScreenModel } from '@mat/project-schema';

export interface Layer {
  item: Item;
  /** Vị trí trong mảng `items` (đầu mảng ở dưới cùng). */
  index: number;
}

/**
 * Các item cần dựng, bỏ `hidden`. Màn hình tự do: theo thứ tự mảng. Màn hình lưới (định dạng 1.1, feature 012): chỉ item
 * có ô trỏ tới, theo thứ tự hàng rồi ô (item mồ côi không dựng, không đăng ký Tag).
 */
export function layersOf(screen: ScreenModel): Layer[] {
  const out: Layer[] = [];
  const grid = (screen as unknown as GridScreen).layout;
  if (grid) {
    const index = new Map(screen.items.map((item, i) => [item.id, i]));
    const seen = new Set<string>();
    for (const { cell } of cellsOf(screen as unknown as GridScreen)) {
      const id = cell.item;
      const i = id === undefined ? undefined : index.get(id);
      if (id === undefined || i === undefined || seen.has(id)) continue;
      seen.add(id);
      const item = screen.items[i]!;
      if (!item.hidden) out.push({ item, index: i });
    }
    return out;
  }
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
