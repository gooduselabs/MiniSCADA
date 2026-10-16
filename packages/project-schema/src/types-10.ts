// Kiểu của định dạng 1.0.0 (feature 011; specs/011-pilot-hardening/contracts/project-format-1.0.md §2-§5,
// contracts/logic-engine.md §1). 1.0 là tập con siêu của 0.6: chỉ thêm trường tùy chọn.
import type { ParamDecl } from './params.ts';
import type { LoadedProject05, Project05 } from './types-05.ts';
import type { Item, ScreenModel } from './types-03.ts';

/** Chú thích của item sinh từ template (§4); runtime và widget bỏ qua. */
export interface TplRef {
  inst: string;
  tid: string;
  rid: string;
  params?: Record<string, string>;
}

/** Item 1.0: item 0.3 cộng `tpl` tùy chọn. */
export type Item10 = Item & { tpl?: TplRef };

/** Màn hình 1.0: popup có thể có `params` (faceplate, §5). */
export interface ScreenModel10 extends Omit<ScreenModel, 'items'> {
  params?: ParamDecl[];
  items: Item10[];
}

/** `templates/<id>.template.json` (§3). */
export interface TemplateDoc {
  schemaVersion: string;
  id: string;
  name: string;
  size: { width: number; height: number };
  params?: ParamDecl[];
  items: Item[];
}

/**
 * `logic.json` (contracts/logic-engine.md §1). Ở định dạng 1.0 bộ kiểm tra chỉ kiểm khung (schema) và phiên bản; luật
 * E_LOGIC_* thuộc T135 (rules-logic).
 */
export interface LogicDoc {
  schemaVersion: string;
  writes?: unknown[];
  rules?: unknown[];
  timers?: unknown[];
  counters?: unknown[];
  totalizers?: unknown[];
  runhours?: unknown[];
  schedules?: unknown[];
}

export type Project10 = Project05 & {
  /** Đường dẫn tương đối của logic.json (tùy chọn). */
  logic?: string;
  /** Tệp template `templates/<id>.template.json` (tùy chọn; thứ tự không có nghĩa). */
  templates?: string[];
};

/** Project 1.0 đã nạp và qua kiểm tra: như 0.5/0.6 cộng logic và template (theo đường dẫn). */
export type LoadedProject10 = Omit<LoadedProject05, 'project'> & {
  project: Project10;
  logic?: LogicDoc;
  templates: Record<string, TemplateDoc>;
};
