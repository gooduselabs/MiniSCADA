// Tập file của project (specs/005-device-online/data-model.md §8; 0.3: specs/007-screens-widgets/contracts/project-format-0.3.md §1): những file Studio đóng gói, và digest nội
// dung tính trên đó. Bản C++ là LoadedProject::files() (core/project-manager); cùng kết quả trên trường
// `files` của vector hợp lệ trong tests/project-vectors.
import { compareUtf8 } from './package-digest.ts';
import type { Project, Screen } from './types.ts';

/** Phần của project đã nạp mà tập file cần. `LoadedProject` của `validateProject` thỏa kiểu này. */
export interface ProjectFileRefs {
  project: Pick<
    Project,
    | 'tagFile'
    | 'loggingFile'
    | 'screens'
    | 'connectionFile'
    | 'valueTables'
    | 'watchTables'
    | 'reportsFile'
  > & {
    /** Định dạng 0.5 (feature 009). */
    alarmFile?: string;
    alarmClassFile?: string;
    /** Định dạng 1.0 (feature 011). */
    logic?: string;
    templates?: readonly string[];
    /** Định dạng 1.1 (feature 024). */
    recipesFile?: string;
  };
  /** Feature 024: logo của báo cáo (`reports.json` `logo`) thuộc tập file. */
  reports?: { logo?: string };
  screens: Readonly<Record<string, { screen: ScreenRefs }>>;
}

/** Màn hình 0.1/0.2 (một SVG, một binding) hoặc 0.3 (mỗi item `svg` có SVG và binding riêng). */
export type ScreenRefs =
  | Pick<Screen, 'bindingFile' | 'svgFile'>
  | {
      items: ReadonlyArray<{
        type: string;
        svgFile?: string;
        bindingFile?: string;
        /** Feature 014: widget `image` trỏ tệp SVG của project ở `props.src`. */
        widget?: string;
        props?: Readonly<Record<string, unknown>>;
      }>;
    };

/** Tệp SVG của widget `image` (feature 014): `props.src` khác rỗng, không thì undefined. */
export function imageFileOf(item: {
  type: string;
  widget?: string;
  props?: Readonly<Record<string, unknown>>;
}): string | undefined {
  const src = item.type === 'widget' && item.widget === 'image' ? item.props?.src : undefined;
  return typeof src === 'string' && src !== '' ? src : undefined;
}

/**
 * `project.json`, `tagFile`, `loggingFile` (nếu có), và mỗi màn hình: `screens/<id>.screen.json`,
 * `bindingFile`, `svgFile` (0.3: `bindingFile` và `svgFile` của từng item `svg`). Không trùng (hai màn hình dùng chung một SVG), sắp theo byte UTF-8 như
 * `files[]` của manifest. File khác trong thư mục project không thuộc tập này.
 */
export function projectFiles(p: ProjectFileRefs): string[] {
  const files = new Set<string>(['project.json', p.project.tagFile]);
  if (p.project.loggingFile !== undefined) files.add(p.project.loggingFile);
  // Định dạng 0.6 (feature 010): mẫu báo cáo
  if (p.project.reportsFile !== undefined) files.add(p.project.reportsFile);
  // Định dạng 0.2 (contract project-format-0.2 §1)
  if (p.project.connectionFile !== undefined) files.add(p.project.connectionFile);
  for (const name of p.project.valueTables ?? []) files.add(`value-tables/${name}.json`);
  for (const id of p.project.watchTables ?? []) files.add(`watch-tables/${id}.json`);
  // Định dạng 0.5 (contract project-format-0.5 §1)
  if (p.project.alarmFile !== undefined) files.add(p.project.alarmFile);
  if (p.project.alarmClassFile !== undefined) files.add(p.project.alarmClassFile);
  // Định dạng 1.0 (contracts/project-format-1.0.md §2, §6): logic.json và các tệp template khai trong project.json
  if (p.project.logic !== undefined) files.add(p.project.logic);
  for (const t of p.project.templates ?? []) files.add(t);
  // Định dạng 1.1 (feature 024): recipe, logo của báo cáo
  if (p.project.recipesFile !== undefined) files.add(p.project.recipesFile);
  if (p.reports?.logo !== undefined) files.add(p.reports.logo);
  for (const id of p.project.screens) {
    files.add(`screens/${id}.screen.json`);
    if (!Object.prototype.hasOwnProperty.call(p.screens, id)) continue;
    const { screen } = p.screens[id]!;
    if ('items' in screen) {
      // Định dạng 0.3: file của từng item svg (contract project-format-0.3 §1)
      for (const item of screen.items) {
        const image = imageFileOf(item);
        if (image !== undefined) files.add(image);
        if (item.type !== 'svg') continue;
        if (item.svgFile !== undefined) files.add(item.svgFile);
        if (item.bindingFile !== undefined) files.add(item.bindingFile);
      }
    } else {
      files.add(screen.bindingFile);
      files.add(screen.svgFile);
    }
  }
  return [...files].sort(compareUtf8);
}

/**
 * Tệp bị loại (feature 011, contract project-format-1.0 §6, FR-024): Studio không đóng gói, runtime từ chối
 * kể cả khi manifest liệt kê (`E_PACKAGE_EXTRA_FILE`). Bản C++ `packageExcludedPath`, Rust `excluded_path`.
 */
export function isPackExcluded(path: string): boolean {
  const segments = path.split('/');
  if (segments.some((s) => s.startsWith('.') || s === 'node_modules')) return true;
  const name = segments[segments.length - 1]!;
  const lower = name.toLowerCase();
  return (
    lower === 'thumbs.db' ||
    lower === 'desktop.ini' ||
    name.startsWith('~') ||
    lower.endsWith('.tmp')
  );
}

/**
 * Tệp thừa: mục của `present` (tệp có trong gói hay thư mục) không thuộc `files` (tập file của project,
 * `projectFiles`), sắp theo byte UTF-8. Rỗng: digest của gói bằng digest của project.
 */
export function extraProjectFiles(present: readonly string[], files: readonly string[]): string[] {
  const set = new Set(files);
  return [...new Set(present)].filter((p) => !set.has(p)).sort(compareUtf8);
}
