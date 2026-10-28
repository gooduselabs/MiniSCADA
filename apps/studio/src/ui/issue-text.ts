// Thông điệp tiếng Việt cho dòng lỗi ở tab Thông tin (036): mã lỗi bố cục lưới (rules-11) được dịch kèm tên màn
// hình và số hàng/ô; mã khác giữ thông điệp gốc của bộ kiểm.
import { GRID_COLUMNS, GRID_LIMITS, type Issue } from '@mat/project-schema';
import type { StudioApp } from '../app/app.ts';
import { t } from '../i18n/index.ts';

/** Tên màn hình chứa file `issue.file` ('screens/<id>.screen.json'), vắng thì id. */
function screenName(app: StudioApp, file: string): string | null {
  const m = /^screens\/(.+)\.screen\.json$/.exec(file);
  if (!m) return null;
  const s = app.store.state.outline.screens.find((x) => x.id === m[1]);
  const name = (s?.model as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? name : m[1]!;
}

/** Thông điệp dễ hiểu của một lỗi (tiếng Việt khi biết mã, không thì thông điệp gốc). */
export function issueText(app: StudioApp, it: Issue): string {
  if (!it.code.startsWith('E_LAYOUT_')) return it.message;
  const screen = screenName(app, it.file) ?? it.file;
  const row = /\/layout\/rows\/(\d+)/.exec(it.path ?? '');
  const cell = /\/cells\/(\d+)/.exec(it.path ?? '');
  const r = row ? Number(row[1]) + 1 : 0;
  const c = cell ? Number(cell[1]) + 1 : 0;
  switch (it.code) {
    case 'E_LAYOUT_LIMIT':
      return row
        ? t('issue.layout.cells', { screen, row: r, max: GRID_LIMITS.cellsPerRow })
        : t('issue.layout.rows', { screen, max: GRID_LIMITS.rows });
    case 'E_LAYOUT_SPAN':
      return t('issue.layout.span', { screen, row: r, cell: c, cols: GRID_COLUMNS });
    case 'E_LAYOUT_ID':
      return t('issue.layout.id', { screen });
    case 'E_LAYOUT_ITEM_REF':
      return t('issue.layout.itemRef', { screen, row: r, cell: c });
    case 'E_LAYOUT_ITEM_DUP':
      return t('issue.layout.itemDup', { screen });
    case 'E_LAYOUT_COLUMNS':
      return t('issue.layout.columns', { screen, cols: GRID_COLUMNS });
    default:
      return `${screen}: ${it.message}`;
  }
}
