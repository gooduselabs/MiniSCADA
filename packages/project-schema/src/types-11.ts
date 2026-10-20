// Kiểu của định dạng 1.1.0 (feature 012; specs/012-screen-grid-layout/contracts/project-format-1.1.md, data-model.md).
// 1.1 là tập con siêu của 1.0: màn hình thêm `layout` (lưới 12 cột: hàng → ô, ô tham chiếu item theo id), project
// thêm `theme`. Item của màn hình lưới không có `x`, `y`, `width`, `height`.
import type { Item10, ScreenModel10 } from './types-10.ts';

export type CellAlign = 'start' | 'center' | 'end' | 'stretch';

export interface GridCell {
  id: string;
  /** 1 đến 12 cột. */
  span: number;
  /** Số cột trống đứng trước ô, 0 đến 11; thiếu = 0. */
  offset?: number;
  /** Thiếu = `stretch`. */
  align?: CellAlign;
  /** Điểm ảnh, 0 đến 4.000. */
  minHeight?: number;
  /** `id` của một item trong `items[]`; thiếu = ô trống. */
  item?: string;
}

export interface GridRow {
  id: string;
  /** `auto` (theo nội dung) hoặc 24 đến 4.000 điểm ảnh. */
  height: 'auto' | number;
  gap?: number;
  cells: GridCell[];
}

export interface GridLayout {
  mode: 'grid';
  /** Luôn 12 (D1). */
  columns: number;
  /** Điểm ảnh, 0 đến 64; thiếu = 12. */
  gap?: number;
  /** Điểm ảnh, 0 đến 64; thiếu = 16. */
  padding?: number;
  rows: GridRow[];
}

type Positioned = 'x' | 'y' | 'width' | 'height';

/** `Omit` phân phối trên từng nhánh của kiểu hợp (giữ trường riêng của item svg và widget). */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Item có thể thiếu vị trí (màn hình lưới); màn hình tự do vẫn phải có đủ (luật `E_LAYOUT_ITEM_POS`). */
export type LooseItem = DistOmit<Item10, Positioned> & Partial<Pick<Item10, Positioned>>;

/** Màn hình 1.1: `layout` tùy chọn; thiếu là bố cục tự do như 1.0. */
export interface GridScreen extends Omit<ScreenModel10, 'items' | 'kind'> {
  kind?: ScreenModel10['kind'];
  layout?: GridLayout;
  items: LooseItem[];
}

export type ProjectTheme = 'vivid' | 'industrial' | 'dark';
