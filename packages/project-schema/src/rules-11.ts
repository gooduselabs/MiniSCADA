// Luật của định dạng 1.1 (feature 012, T010; specs/012-screen-grid-layout/contracts/project-format-1.1.md §3): bố cục
// lưới của màn hình (`layout`) và chủ đề (`theme`). Chạy cho cả họ 1.x (1.0 và 1.1 dùng chung bộ schema ở thư mục gốc,
// nên `x`, `y`, `width`, `height` của item đã thành tùy chọn ở schema: luật này đòi chúng ở màn hình tự do).
// Bản C++ phải cài giống hệt: core/project-manager/rules_11.cpp (T012), cùng vector tests/project-vectors/v11-*.
import {
  MIN_RUNTIME_11,
  SUPPORTED_SCHEMA_11,
  type ErrorCode,
  type Issue,
  type WarningCode,
} from './codes.ts';
import { GRID_COLUMNS, GRID_LIMITS } from './layout.ts';
import { compareSemver } from './rules.ts';
import type { GridScreen } from './types-11.ts';

export interface Rule11Input {
  project: { schemaVersion: string; minRuntimeVersion?: string; theme?: unknown };
  /** Màn hình và popup đã qua schema, theo id. */
  screens: Readonly<Record<string, { file: string; screen: unknown }>>;
}

const POS_FIELDS = ['x', 'y', 'width', 'height'] as const;
const LAYOUT_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export function runRules11(input: Rule11Input): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: ErrorCode, file: string, path: string, message: string) =>
    errors.push({ code, file, path, message });
  const warn = (code: WarningCode, file: string, path: string, message: string) =>
    warnings.push({ code, file, path, message });

  const { project } = input;
  const is11 = SUPPORTED_SCHEMA_11.test(project.schemaVersion);
  if (!is11 && project.theme !== undefined)
    err('E_LAYOUT_VERSION', 'project.json', '/theme', 'theme needs project format 1.1');
  if (
    is11 &&
    typeof project.minRuntimeVersion === 'string' &&
    compareSemver(project.minRuntimeVersion, MIN_RUNTIME_11) < 0
  )
    err(
      'E_LAYOUT_VERSION',
      'project.json',
      '/minRuntimeVersion',
      `a 1.1 project needs minRuntimeVersion >= ${MIN_RUNTIME_11}`,
    );

  for (const { file, screen: raw } of Object.values(input.screens)) {
    const screen = raw as GridScreen;
    if (!screen || !Array.isArray(screen.items)) continue;
    const layout = screen.layout;
    const rec = (i: number) => screen.items[i] as unknown as Record<string, unknown>;

    if (layout === undefined) {
      // màn hình tự do: đủ vị trí và kích thước
      screen.items.forEach((_, i) => {
        const missing = POS_FIELDS.find((k) => rec(i)[k] === undefined);
        if (missing)
          err(
            'E_LAYOUT_ITEM_POS',
            file,
            `/items/${i}/${missing}`,
            `free-layout item needs ${missing}`,
          );
      });
      continue;
    }
    if (!is11) {
      err('E_LAYOUT_VERSION', file, '/layout', 'a grid layout needs project format 1.1');
      continue;
    }

    if (layout.mode !== 'grid')
      err('E_LAYOUT_COLUMNS', file, '/layout/mode', `layout mode must be 'grid'`);
    if (layout.columns !== GRID_COLUMNS)
      err('E_LAYOUT_COLUMNS', file, '/layout/columns', `a grid has ${GRID_COLUMNS} columns`);
    if (layout.rows.length > GRID_LIMITS.rows)
      err('E_LAYOUT_LIMIT', file, '/layout/rows', `more than ${GRID_LIMITS.rows} rows`);

    const itemIds = new Set(screen.items.map((it) => it.id));
    const layoutIds = new Set<string>();
    const placed = new Set<string>();
    const checkId = (id: string, path: string) => {
      if (!LAYOUT_ID_RE.test(id) || layoutIds.has(id))
        err('E_LAYOUT_ID', file, path, `row or cell id '${id}' is invalid or duplicated`);
      layoutIds.add(id);
    };

    layout.rows.forEach((row, r) => {
      const rp = `/layout/rows/${r}`;
      checkId(row.id, `${rp}/id`);
      if (row.cells.length === 0 || row.cells.length > GRID_LIMITS.cellsPerRow)
        err(
          'E_LAYOUT_LIMIT',
          file,
          `${rp}/cells`,
          `a row has 1 to ${GRID_LIMITS.cellsPerRow} cells`,
        );
      let sum = 0;
      let overflowReported = false;
      row.cells.forEach((cell, c) => {
        const cp = `${rp}/cells/${c}`;
        checkId(cell.id, `${cp}/id`);
        const offset = cell.offset ?? 0;
        const badRange =
          !Number.isInteger(cell.span) ||
          cell.span < 1 ||
          cell.span > GRID_COLUMNS ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > GRID_COLUMNS - 1;
        sum += offset + cell.span;
        if (badRange) err('E_LAYOUT_SPAN', file, `${cp}/span`, 'span 1-12 and offset 0-11');
        else if (sum > GRID_COLUMNS && !overflowReported) {
          overflowReported = true;
          err('E_LAYOUT_SPAN', file, `${cp}/span`, `the row is wider than ${GRID_COLUMNS} columns`);
        }
        if (cell.item === undefined) return;
        if (!itemIds.has(cell.item))
          err('E_LAYOUT_ITEM_REF', file, `${cp}/item`, `no item '${cell.item}' on this screen`);
        else if (placed.has(cell.item))
          err(
            'E_LAYOUT_ITEM_DUP',
            file,
            `${cp}/item`,
            `item '${cell.item}' is in more than one cell`,
          );
        else placed.add(cell.item);
      });
    });

    screen.items.forEach((it, i) => {
      const present = POS_FIELDS.find((k) => rec(i)[k] !== undefined);
      if (present)
        err('E_LAYOUT_ITEM_POS', file, `/items/${i}/${present}`, 'a grid item has no position');
      if (!placed.has(it.id))
        warn('W_LAYOUT_ITEM_ORPHAN', file, `/items/${i}`, `item '${it.id}' is in no cell`);
    });
  }
  return { errors, warnings };
}
