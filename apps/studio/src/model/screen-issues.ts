// Ánh xạ `Issue` của bộ kiểm tra (đường dẫn JSON Pointer) tới item và ô inspector của màn hình
// (feature 007, T106; FR-068). Hàm thuần, không chuỗi hiển thị.
import type { Issue, ScreenModel } from '@mat/project-schema';
import { severityOf, type Severity } from './issue-map.ts';

/**
 * Ô inspector: `rect` (X, Y, Rộng, Cao), `prop:<tên>`, `tag:<khe>`, `event`, `security`, hoặc `item`
 * (cả item: id, loại, đồ họa, hoặc lỗi chưa gắn được vào một ô).
 */
export type ItemField = string;

export interface ItemPath {
  itemIndex: number;
  field: ItemField;
}
export interface IssueLocation extends ItemPath {
  itemId: string;
}
export interface ItemIssue {
  issue: Issue;
  field: ItemField;
  severity: Severity;
}

const RECT_KEYS = new Set(['x', 'y', 'width', 'height']);
const unescape = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');

/** `/items/<n>/...` → chỉ số item và ô; đường dẫn không thuộc một item thì `null`. */
export function parseItemPath(path: string): ItemPath | null {
  const seg = path.split('/');
  if (seg[0] !== '' || seg[1] !== 'items' || seg[2] === undefined || !/^\d+$/.test(seg[2]))
    return null;
  const itemIndex = Number(seg[2]);
  const head = seg[3];
  const name = seg[4];
  if (head === undefined) return { itemIndex, field: 'item' };
  if (RECT_KEYS.has(head)) return { itemIndex, field: 'rect' };
  if (head === 'props' && name !== undefined) return { itemIndex, field: `prop:${unescape(name)}` };
  if (head === 'tags' && name !== undefined) return { itemIndex, field: `tag:${unescape(name)}` };
  if (head === 'events') return { itemIndex, field: 'event' };
  if (head === 'security') return { itemIndex, field: 'security' };
  return { itemIndex, field: 'item' };
}

/** Vị trí của Issue trong màn hình `doc`; `null` nếu không thuộc item hoặc chỉ số không còn tồn tại. */
export function locateIssue(issue: Issue, doc: ScreenModel): IssueLocation | null {
  const p = parseItemPath(issue.path);
  const item = p === null ? undefined : doc.items[p.itemIndex];
  if (p === null || item === undefined) return null;
  return { ...p, itemId: item.id };
}

/** Đích khi nhấp đôi một dòng lỗi: chọn item và đưa focus tới ô. */
export function jumpTarget(
  issue: Issue,
  doc: ScreenModel,
): { itemId: string; field: ItemField } | null {
  const loc = locateIssue(issue, doc);
  return loc === null ? null : { itemId: loc.itemId, field: loc.field };
}

/** Các Issue thuộc file `screens/<id>.screen.json`. */
export const screenIssues = (issues: readonly Issue[], screenId: string): Issue[] =>
  issues.filter((i) => i.file === `screens/${screenId}.screen.json`);

/** Nhóm theo id item (giữ thứ tự xuất hiện); Issue không gắn được vào item vào `other`. */
export function groupByItem(
  issues: readonly Issue[],
  doc: ScreenModel,
): { byItem: Map<string, ItemIssue[]>; other: Issue[] } {
  const byItem = new Map<string, ItemIssue[]>();
  const other: Issue[] = [];
  for (const issue of issues) {
    const loc = locateIssue(issue, doc);
    if (loc === null) {
      other.push(issue);
      continue;
    }
    const list = byItem.get(loc.itemId) ?? [];
    list.push({ issue, field: loc.field, severity: severityOf(issue) });
    byItem.set(loc.itemId, list);
  }
  return { byItem, other };
}

const worst = (list: readonly ItemIssue[]): Severity | null =>
  list.length === 0 ? null : list.some((e) => e.severity === 'error') ? 'error' : 'warning';

/** Viền của item: `error` thắng `warning`; không có thì `null`. */
export const severityOfItem = (entries: readonly ItemIssue[] | undefined): Severity | null =>
  worst(entries ?? []);

/** Viền của một ô (khớp đúng `field`). */
export const severityOfField = (
  entries: readonly ItemIssue[] | undefined,
  field: ItemField,
): Severity | null => worst((entries ?? []).filter((e) => e.field === field));
