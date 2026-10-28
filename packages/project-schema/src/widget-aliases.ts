// Feature 037 (danh mục 0.8.0): gộp các loại widget trùng chức năng. Loại cũ vẫn có trong danh mục (đánh dấu
// `deprecated`) nên validator TS/C++ và runtime vẫn nhận và vẽ project cũ; Studio gọi các hàm ở đây khi mở project để
// chuyển item sang loại mới tương đương (một lần, người dùng lưu thì ghi đĩa).
import type { PropValue, WidgetItem } from './types-03.ts';

type Props = Record<string, PropValue>;

const TILE_ACCENTS: readonly string[] = [
  'teal',
  'blue',
  'rose',
  'violet',
  'olive',
  'indigo',
  'orange',
  'cyan',
  'green',
  'slate',
];

/** `stat-tile` (Thẻ chỉ số màu) → `card` kiểu nền đặc: giữ màu, biểu tượng, dòng trạng thái, khe Tag. */
function statTileToCard(it: WidgetItem): WidgetItem {
  const src: Props = { ...(it.props ?? {}) };
  const props: Props = { fill: 'solid', fontSize: 'l', statusText: true };
  const color = src['color'];
  delete src['color'];
  // Màu ngoài bảng (project sửa tay) về teal, mặc định cũ của stat-tile: thẻ mới luôn hợp lệ với danh mục.
  props['accent'] = typeof color === 'string' && TILE_ACCENTS.includes(color) ? color : 'teal';
  for (const [k, v] of Object.entries(src)) props[k] = v;
  return { ...it, widget: 'card', props };
}

/**
 * `lamp` (Đèn báo) → `multi-state` kiểu đèn: cùng cách hiểu giá trị (bảng giá trị của Tag nếu `useValueTable`, còn lại khác 0
 * = bật, `invert`, màu bật/tắt, nhấp nháy khi bật, quầng sáng), giữ nhãn và khe Tag (`state` → `value`).
 */
function lampToMultiState(it: WidgetItem): WidgetItem {
  const src: Props = { ...(it.props ?? {}) };
  const shape = src['shape'] === 'square' ? 'lamp-square' : 'lamp';
  delete src['shape'];
  const props: Props = { shape, ...src };
  const tags = { ...(it.tags ?? {}) };
  if (tags['state'] !== undefined) {
    tags['value'] = tags['state'];
    delete tags['state'];
  }
  return { ...it, widget: 'multi-state', props, ...(it.tags ? { tags } : {}) };
}

const ALIASES: Readonly<Record<string, (it: WidgetItem) => WidgetItem>> = {
  'stat-tile': statTileToCard,
  lamp: lampToMultiState,
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
    // Item sinh từ template (`tpl`) giữ nguyên: đổi riêng nó sẽ lệch template (W_TEMPLATE_DRIFT); template vẫn vẽ loại cũ.
    const n = it && typeof it === 'object' && !('tpl' in it) ? upgradeLegacyItem(it) : it;
    if (n !== it) changed = true;
    return n;
  });
  return changed ? { ...screen, items } : null;
}
