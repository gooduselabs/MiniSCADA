// Ánh xạ lỗi và cảnh báo của bộ kiểm tra dùng chung tới editor và ô (feature 004, data-model §5,
// FR-018): nhấp đúp hoặc Enter trên dòng của tab Thông tin mở đúng editor, chọn đúng ô hoặc trường;
// Bảng Tag tô viền đỏ các ô có lỗi. Hàm thuần trên cấu trúc project đọc được (outlineOf).
import type { Issue } from '@mat/project-schema';
import type { TagColumn } from './grid-model.ts';
import { TAG_KEY_ORDER, type ProjectOutline } from './project-doc.ts';

export type Location =
  | { editor: 'tags'; row: number; column: TagColumn | string }
  /** Kênh và thiết bị trường theo chỉ số trong connections.json (feature 006). */
  | { editor: 'connections'; channel?: number; device?: number }
  /** Bảng theo dõi theo id bảng và chỉ số dòng. */
  | { editor: 'watch'; id: string; row?: number }
  | { editor: 'settings'; field: string }
  /** Không có group/connection: mở Lưu trữ (cảnh báo của cả file, ví dụ ước tính ghi). */
  | { editor: 'logging'; group?: number; connection?: number }
  | { editor: 'screen'; screen: string; element: string }
  | { editor: null };

export type Severity = 'error' | 'warning';

/** Lỗi nếu mã bắt đầu bằng E_, cảnh báo nếu bắt đầu bằng W_ (data-model §5). */
/** Khóa ô `dòng:cột` (cùng dạng `cellId` của lưới dùng chung). */
const cellKey = (row: number, column: string): string => `${row}:${column}`;

export const severityOf = (issue: Pick<Issue, 'code'>): Severity =>
  issue.code.startsWith('W_') ? 'warning' : 'error';

/** File không đọc được: không có editor nào hiện được nội dung. */
const UNREADABLE = new Set(['E_JSON', 'E_FILE_MISSING']);
const NONE: Location = { editor: null };

/** JSON Pointer → các đoạn (`/a~1b` → ['a/b']). */
const segments = (path: string): string[] =>
  path === ''
    ? []
    : path
        .split('/')
        .slice(1)
        .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

const index = (s: string | undefined): number | null =>
  s !== undefined && /^(0|[1-9]\d*)$/.test(s) ? Number(s) : null;

const isTagColumn = (s: string | undefined): s is TagColumn =>
  (TAG_KEY_ORDER as readonly string[]).includes(s ?? '');

/** Cột của lưới 0.2 cho trường lồng trong Tag v1 (`/tags/N/<trường>[/<con>]`). */
function columnV1(seg: string[]): string {
  const [field, sub] = [seg[2], seg[3]];
  switch (field) {
    case 'source':
      return ['device', 'address', 'scanGroup', 'rawType', 'byteOrder'].includes(sub ?? '')
        ? sub
        : 'address';
    case 'scaling':
      return ['rawMin', 'rawMax', 'engMin', 'engMax'].includes(sub ?? '') ? sub : 'rawMin';
    case 'limits':
      return sub === 'max' || sub === 'maxLength' ? 'limMax' : 'limMin';
    case 'sim':
      return 'simKind';
    case undefined:
      return 'id';
    default:
      return field;
  }
}

export function locate(issue: Issue, outline: ProjectOutline): Location {
  if (UNREADABLE.has(issue.code)) return NONE;
  const seg = segments(issue.path);

  if (issue.file === outline.tagFile) {
    const row = seg[0] === 'tags' ? index(seg[1]) : null;
    if (row === null) return NONE;
    if (seg.length === 2)
      return { editor: 'tags', row, column: issue.code === 'E_TAG_RANGE' ? 'max' : 'id' };
    if (outline.version === '0.2') return { editor: 'tags', row, column: columnV1(seg) };
    return { editor: 'tags', row, column: isTagColumn(seg[2]) ? seg[2] : 'id' };
  }

  if (outline.connectionFile !== null && issue.file === outline.connectionFile) {
    const c = seg[0] === 'channels' ? index(seg[1]) : null;
    if (c === null) return { editor: 'connections' };
    const d = seg[2] === 'devices' ? index(seg[3]) : null;
    return d === null
      ? { editor: 'connections', channel: c }
      : { editor: 'connections', channel: c, device: d };
  }

  const watch = outline.watchTables.find((w) => w.file === issue.file);
  if (watch) {
    const r = seg[0] === 'rows' ? index(seg[1]) : null;
    return r === null
      ? { editor: 'watch', id: watch.id }
      : { editor: 'watch', id: watch.id, row: r };
  }

  if (issue.file === 'project.json')
    return seg.length ? { editor: 'settings', field: seg[0] } : NONE;

  if (outline.loggingFile !== null && issue.file === outline.loggingFile) {
    const i = index(seg[1]);
    if (seg[0] === 'groups' && i !== null) return { editor: 'logging', group: i };
    if (seg[0] === 'connections' && i !== null) return { editor: 'logging', connection: i };
    return { editor: 'logging' };
  }

  const screen = outline.screens.find((s) => s.bindingFile === issue.file);
  if (screen) {
    const k = seg[0] === 'elements' ? index(seg[1]) : null;
    const uid = k === null ? undefined : screen.bindings?.elements[k]?.elementUid;
    return typeof uid === 'string' ? { editor: 'screen', screen: screen.id, element: uid } : NONE;
  }
  return NONE;
}

/**
 * Ô có lỗi hoặc cảnh báo trong Bảng Tag, theo khóa `dòng:cột` (cellKey): lỗi một trường tô đúng ô đó;
 * E_TAG_RANGE cả dòng tô cả Min và Max (data-model §5).
 */
export function issueCells(
  issues: readonly Issue[],
  outline: ProjectOutline,
): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  const add = (k: string, issue: Issue) => out.set(k, [...(out.get(k) ?? []), issue]);
  for (const issue of issues) {
    const loc = locate(issue, outline);
    if (loc.editor !== 'tags') continue;
    const whole = issue.code === 'E_TAG_RANGE' && segments(issue.path).length === 2;
    if (whole) {
      add(cellKey(loc.row, 'min'), issue);
      add(cellKey(loc.row, 'max'), issue);
    } else add(cellKey(loc.row, loc.column), issue);
  }
  return out;
}
