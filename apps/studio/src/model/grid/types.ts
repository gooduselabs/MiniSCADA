// Kiểu của lưới dùng chung (feature 006, ADR-016, data-model §13.2): Bảng Tag, Bảng giá trị, Bảng theo dõi dùng chung
// một mô hình lưới thuần (không DOM) theo `GridAdapter`. Adapter nói cho lưới biết cột, nội dung ô, và đổi chữ gõ vào
// thành sửa đổi project (ProjectEdit); lưới lo chọn vùng, bộ gõ, sao chép và dán, CSV, điền xuống, lọc, sắp xếp.
import type { MessageKey } from '../../i18n/index.ts';
import type { ProjectEdit } from '../project-doc.ts';

/**
 * - `text`, `number`: ô nhập; `number` đọc theo dấu thập phân đã chọn khi dán và nhập CSV;
 * - `select`: danh sách chọn (ô nhập làm ô lọc, combobox);
 * - `readonly`: chỉ xem (mã hàm, offset…); `live`: giá trị sống khi Online;
 * - `color`: màu `#RRGGBB`; `bool`: đúng/sai.
 */
export type ColKind = 'text' | 'number' | 'select' | 'readonly' | 'live' | 'color' | 'bool';

export interface GridColumn {
  key: string;
  /** Nhãn đã dịch (adapter gọi t()). */
  label: string;
  kind: ColKind;
  /** Bề rộng gợi ý (px). */
  width: number;
  /** Phông đơn cách (tên Tag, địa chỉ, biểu thức). */
  mono?: boolean;
  /** Cột tên: điền xuống và kéo điền tăng số (`TANK_01` → `TANK_02`). */
  name?: boolean;
  /** Căn phải (số). */
  end?: boolean;
  /** Tiêu đề cột trong CSV (mặc định `label`). */
  csv?: string;
}

/** Vị trí một ô: `row` là chỉ số dòng gốc của adapter (không phải vị trí đang hiện). */
export interface Pos {
  row: number;
  col: string;
}

/**
 * Một thay đổi chữ của ô. `row = null` là ô của dòng mới: `newIndex` là thứ tự dòng mới trong lần áp này (0, 1, …),
 * adapter tạo các dòng mới theo thứ tự đó.
 */
export interface CellChange {
  row: number | null;
  newIndex?: number;
  col: string;
  text: string;
}

/** Ô bị từ chối (chữ không đổi được thành giá trị): lưới đánh dấu lỗi tại ô. */
export interface Rejected {
  row: number | null;
  newIndex?: number;
  col: string;
  text: string;
  reason: MessageKey | string;
}

export interface ApplyResult {
  edits: ProjectEdit[];
  rejected: Rejected[];
}

export interface GridAdapter {
  readonly columns: readonly GridColumn[];
  /** Số dòng hiện có (chưa lọc). */
  rowCount(): number;
  /** Số dòng tối đa của bảng (Bảng Tag 2.000, bảng giá trị 256, bảng theo dõi 200). */
  readonly maxRows: number;
  /** Chữ của ô: cũng là chữ ban đầu khi sửa, khi sao chép và khi xuất CSV. */
  text(row: number, col: string): string;
  /** Ô có sửa được không (cột `readonly` luôn không; ô có điều kiện thì adapter trả false). */
  editable(row: number, col: string): boolean;
  /** Danh sách chọn của ô `select` (null: nhập tự do). */
  options?(row: number, col: string): readonly string[] | null;
  /** Đổi các thay đổi chữ thành sửa đổi project; ô không đổi được thì trả trong `rejected` (phần còn lại vẫn áp). */
  apply(changes: readonly CellChange[]): ApplyResult;
  /** Sửa đổi xóa các dòng. */
  remove?(rows: readonly number[]): ProjectEdit[];
  /** Thêm một dòng mới ở cuối theo dòng cuối; trả sửa đổi và (nếu có) chỉ số dòng mới sẽ có. */
  append?(): { edits: ProjectEdit[]; row: number };
  /**
   * Chữ của ô khi điền xuống từ ô nguồn `above` sau `steps` dòng (cột có hàm tăng riêng, ví dụ địa chỉ tăng theo số
   * thanh ghi của kiểu). Trả `undefined`: dùng mặc định (cột tên tăng số, cột khác chép nguyên).
   */
  fillNext?(row: number, col: string, above: string, steps: number): string | undefined;
  /** Chữ để tìm (ô tìm); mặc định ghép mọi ô. */
  searchText?(row: number): string;
}

/** Khóa của ô cho bảng ô lỗi (cùng dạng `dòng:cột` với `cellKey` của 004). */
export const cellId = (row: number | null, col: string, newIndex?: number): string =>
  row === null ? `+${newIndex ?? 0}:${col}` : `${row}:${col}`;
