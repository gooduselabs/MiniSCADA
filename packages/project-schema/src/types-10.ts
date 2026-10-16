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

/** Hằng của `logic.json` (contracts/logic-engine.md §1). */
export type LogicScalar = boolean | number | string;
/** Giá trị của hành động: hằng hoặc biểu thức một giá trị. */
export type LogicValue = LogicScalar | { expr: string };

export interface LogicWrite {
  id: string;
  tag: string;
  allowed: { values: LogicScalar[] } | { min: number; max: number };
  minIntervalMs?: number;
  maxPerHour?: number;
}

export interface LogicAction {
  /** `setTag`, `toggle`, `write`, `pulse` (giá trị khác: lỗi của luật, không của schema). */
  do: string;
  tag?: string;
  write?: string;
  value?: LogicValue;
  ms?: number;
}

export interface LogicRule {
  id: string;
  name?: string;
  enabled?: boolean;
  when: string;
  hold?: number;
  fireOnStart?: boolean;
  repeatMs?: number;
  onRise?: LogicAction[];
  onFall?: LogicAction[];
}

export interface LogicTimer {
  id: string;
  kind: string;
  in: string;
  pt: number;
  q: string;
  et?: string;
}

export interface LogicCounter {
  id: string;
  up: string;
  down?: string | null;
  reset?: string | null;
  preset?: number | null;
  value: string;
  reached?: string;
  retain?: boolean;
}

export interface LogicTotalizer {
  id: string;
  source: string;
  rateUnit: string;
  factor?: number;
  cutoff?: number;
  maxGapMs?: number;
  reset?: string | null;
  rolloverAt?: number;
  total: string;
  gapSeconds?: string;
  retain?: boolean;
}

export interface LogicRunhours {
  id: string;
  run: string;
  reset?: string | null;
  serviceEveryHours?: number | null;
  hours: string;
  starts?: string;
  due?: string;
  retain?: boolean;
}

export interface LogicWindow {
  days: number[];
  from: string;
  to: string;
}

export interface LogicSchedule {
  id: string;
  tzOffsetMin?: number | null;
  weekly: LogicWindow[];
  exceptions?: Array<{ date: string; mode: string }>;
  out: string;
}

/** `logic.json` (contracts/logic-engine.md §1); khung kiểm bằng schema, luật E_LOGIC_* ở rules-logic.ts. */
export interface LogicDoc {
  schemaVersion: string;
  writes?: LogicWrite[];
  rules?: LogicRule[];
  timers?: LogicTimer[];
  counters?: LogicCounter[];
  totalizers?: LogicTotalizer[];
  runhours?: LogicRunhours[];
  schedules?: LogicSchedule[];
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
