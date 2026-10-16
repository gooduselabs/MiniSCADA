// Ánh xạ Issue của bộ kiểm tra (file binding của item `svg`) tới phần tử, dòng binding và ô của inspector (feature 008,
// T068; FR-031, FR-042; contract studio-svg-editor §5, §8). Hàm thuần, không chuỗi hiển thị. Đường dẫn là JSON Pointer
// trong `screens/<màn hình>.<item>.bindings.json`: `/elements/<i>/bindings/<j>/...` hoặc `/elements/<i>/events/click/...`.
import type { BindingSet04, Issue } from '@mat/project-schema';
import { severityOf, type Severity } from './issue-map.ts';
import { rowOfBinding } from './animation-catalog.ts';

/**
 * Ô: `element` (cả phần tử), `target`, `tag`, `transform`, `range:<n>` (ô của bảng Khoảng), `param:<khóa>`,
 * `event:<trường>` (`action` khi lỗi chung của hành động).
 */
export type SvgField = string;

export interface SvgIssueLocation {
  elementUid: string;
  /** `id` binding; vắng với lỗi sự kiện hoặc lỗi cả phần tử. */
  bindingId?: string;
  /** Mục của inspector (`fill`, `spin`...) hoặc `event`. */
  rowId?: string;
  field: SvgField;
}
export interface SvgIssue extends SvgIssueLocation {
  issue: Issue;
  severity: Severity;
}

const unescape = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');
const isIdx = (s: string | undefined): s is string => s !== undefined && /^(0|[1-9]\d*)$/.test(s);

/** Tên file binding của item: `screens/<màn hình>.<item>.bindings.json`. */
export const svgBindingFile = (screenId: string, itemId: string): string =>
  `screens/${screenId}.${itemId}.bindings.json`;

/** Các Issue thuộc file binding của item. */
export const itemIssues = (issues: readonly Issue[], screenId: string, itemId: string): Issue[] =>
  issues.filter((i) => i.file === svgBindingFile(screenId, itemId));

/** Vị trí của Issue trong `set`; `null` khi đường dẫn không thuộc một phần tử hoặc chỉ số không còn. */
export function locateSvgIssue(issue: Issue, set: BindingSet04): SvgIssueLocation | null {
  const seg = issue.path.split('/');
  if (seg[0] !== '' || seg[1] !== 'elements' || !isIdx(seg[2])) return null;
  const el = set.elements[Number(seg[2])];
  if (el === undefined) return null;
  const base = { elementUid: el.elementUid };
  const kind = seg[3];
  if (kind === 'events') {
    const key = seg[4] === 'click' ? seg[5] : undefined;
    return {
      ...base,
      rowId: 'event',
      field: `event:${key === undefined ? 'action' : unescape(key)}`,
    };
  }
  if (kind !== 'bindings' || !isIdx(seg[4])) return { ...base, field: 'element' };
  const b = el.bindings?.[Number(seg[4])];
  if (b === undefined) return { ...base, field: 'element' };
  const where = {
    ...base,
    bindingId: b.id,
    ...(rowOfBinding(b) ? { rowId: rowOfBinding(b)!.id } : {}),
  };
  const f = seg[5];
  if (f === undefined || f === 'id') return { ...where, field: 'target' };
  if (f === 'target') return { ...where, field: 'target' };
  if (f === 'source') return { ...where, field: 'tag' };
  if (f === 'transform') {
    if (seg[6] === 'ranges' && isIdx(seg[7])) return { ...where, field: `range:${seg[7]}` };
    return { ...where, field: 'transform' };
  }
  return { ...where, field: `param:${unescape(f)}` };
}

/** Nhóm theo `elementUid` (giữ thứ tự xuất hiện); Issue không gắn được vào phần tử vào `other`. */
export function groupBySvgElement(
  issues: readonly Issue[],
  set: BindingSet04,
): { byElement: Map<string, SvgIssue[]>; other: Issue[] } {
  const byElement = new Map<string, SvgIssue[]>();
  const other: Issue[] = [];
  for (const issue of issues) {
    const loc = locateSvgIssue(issue, set);
    if (loc === null) {
      other.push(issue);
      continue;
    }
    const list = byElement.get(loc.elementUid) ?? [];
    list.push({ ...loc, issue, severity: severityOf(issue) });
    byElement.set(loc.elementUid, list);
  }
  return { byElement, other };
}

const worst = (list: readonly SvgIssue[]): Severity | null =>
  list.length === 0 ? null : list.some((e) => e.severity === 'error') ? 'error' : 'warning';

/** Viền của phần tử (cây phần tử, khung chọn): `error` thắng `warning`. */
export const severityOfElement = (entries: readonly SvgIssue[] | undefined): Severity | null =>
  worst(entries ?? []);

/** Lỗi của một dòng binding (mục `rowId`) hoặc của nhóm Sự kiện (`rowId = 'event'`). */
export const issuesOfRow = (entries: readonly SvgIssue[] | undefined, rowId: string): SvgIssue[] =>
  (entries ?? []).filter((e) => e.rowId === rowId);

/** Viền của một ô trong dòng (khớp đúng `field`). */
export const severityOfSvgField = (
  entries: readonly SvgIssue[] | undefined,
  rowId: string,
  field: SvgField,
): Severity | null => worst((entries ?? []).filter((e) => e.rowId === rowId && e.field === field));

/** Đích khi nhấp đúp một dòng lỗi: chọn phần tử và đưa focus tới dòng, ô. */
export function svgJumpTarget(
  issue: Issue,
  set: BindingSet04,
): { elementUid: string; rowId?: string; field: SvgField } | null {
  const loc = locateSvgIssue(issue, set);
  return loc === null
    ? null
    : { elementUid: loc.elementUid, ...(loc.rowId ? { rowId: loc.rowId } : {}), field: loc.field };
}
