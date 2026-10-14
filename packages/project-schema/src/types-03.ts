// Định dạng 0.3 (specs/007-screens-widgets/data-model.md, contracts/project-format-0.3.md).
// Màn hình là danh sách item tuyệt đối trên khung `size`: item `svg` (đồ họa 0.2 nằm trong item) hoặc `widget`.
import type {
  BindingSet02,
  ConnectionsConfig,
  TagListV1,
  ValueTableDoc,
  WatchTableDoc,
} from './types-02.ts';
import type { ReportsConfig } from './reports.ts';
import type { LoggingConfig, Project } from './types.ts';

export type ScreenKind = 'screen' | 'popup';
export type FitMode03 = 'contain' | 'cover' | 'stretch' | 'fit-width' | 'none';
export type Role03 = 'viewer' | 'operator' | 'engineer' | 'administrator';
export type PropValue = string | number | boolean | PropValue[] | { [k: string]: PropValue };

export type Action =
  | { action: 'write'; value: boolean | number | string }
  | { action: 'toggle' }
  | { action: 'pulse'; value: boolean; durationMs: number }
  | { action: 'navigate'; screen: string }
  | { action: 'popup'; screen: string }
  | { action: 'closePopup' };
export type ActionName = Action['action'];

interface ItemBase {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface SvgItem extends ItemBase {
  type: 'svg';
  svgFile: string;
  bindingFile: string;
  viewBox: [number, number, number, number];
  fit?: 'contain' | 'cover' | 'stretch';
  elements: Array<{ elementUid: string; name?: string; kind?: string }>;
}

export interface WidgetItem extends ItemBase {
  type: 'widget';
  widget: string;
  props?: Record<string, PropValue>;
  /** Khe → id Tag, hoặc mảng id cho khe `multi`. */
  tags?: Record<string, string | string[]>;
  events?: { click?: Action };
  security?: { minRole?: Exclude<Role03, 'viewer'> };
}

export type Item = SvgItem | WidgetItem;

export interface ScreenModel {
  schemaVersion: string;
  id: string;
  name: string;
  kind: ScreenKind;
  size: { width: number; height: number };
  fitMode?: FitMode03;
  background?: string;
  items: Item[];
}

export interface NavigationItem {
  label: string;
  screen?: string;
  /** Định dạng 0.6 (feature 010): mục mở trang báo cáo. */
  report?: string;
  icon?: string;
  items?: NavigationItem[];
}
export interface Navigation {
  position?: 'left' | 'top' | 'hidden';
  items: NavigationItem[];
}
export type Project03 = Project & { navigation?: Navigation };

/** Bộ binding của một item `svg` (cấu trúc 0.2 cộng `itemId`). */
export type BindingSet03 = BindingSet02 & { itemId?: string };

export interface LoadedScreen03 {
  screen: ScreenModel;
  /** Binding theo `id` item `svg`. */
  bindings: Record<string, BindingSet03>;
}

/** Project 0.3 đã nạp và qua kiểm tra. */
export interface LoadedProject03 {
  project: Project03;
  tags: TagListV1;
  connections?: ConnectionsConfig;
  valueTables: Record<string, ValueTableDoc>;
  watchTables: Record<string, WatchTableDoc>;
  screens: Record<string, LoadedScreen03>;
  logging?: LoggingConfig;
  /** Định dạng 0.6 (feature 010). */
  reports?: ReportsConfig;
}
