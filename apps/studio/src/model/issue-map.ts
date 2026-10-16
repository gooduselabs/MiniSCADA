// Ánh xạ lỗi và cảnh báo của bộ kiểm tra dùng chung tới editor và ô (feature 004, data-model §5,
// FR-018): nhấp đúp hoặc Enter trên dòng của tab Thông tin mở đúng editor, chọn đúng ô hoặc trường;
// Bảng Tag tô viền đỏ các ô có lỗi. Hàm thuần trên cấu trúc project đọc được (outlineOf).
import type { Issue } from '@mat/project-schema';
import type { TagColumn } from './grid-model.ts';
import { issueCell } from './alarm-doc.ts';
import { TAG_KEY_ORDER, type ProjectOutline } from './project-doc.ts';

export type Location =
  | { editor: 'tags'; row: number; column: TagColumn | string }
  /** Kênh và thiết bị trường theo chỉ số trong connections.json (feature 006). */
  | { editor: 'connections'; channel?: number; device?: number }
  /** Bảng theo dõi theo id bảng và chỉ số dòng. */
  | { editor: 'watch'; id: string; row?: number }
  | { editor: 'settings'; field: string }
  /** Tag tính toán (feature 006, US4); `tag` vắng thì mở editor ở Tag đầu. */
  | { editor: 'calc'; tag?: string }
  /** Bảng giá trị theo tên; `entry` là chỉ số mục (dòng mặc định là số mục). */
  | { editor: 'valueTable'; name: string; entry?: number; column?: string }
  | { editor: 'driverDiag'; tag?: string }
  /** Không có group/connection: mở Lưu trữ (cảnh báo của cả file, ví dụ ước tính ghi). */
  | { editor: 'logging'; group?: number; connection?: number }
  /** Mẫu báo cáo theo id (feature 010); `column` là chỉ số cột khi lỗi nằm trong lưới cột. */
  | { editor: 'report'; id: string; column?: number }
  | { editor: 'screen'; screen: string; element: string }
  /** Item của màn hình 0.3 (feature 007), kèm ô của inspector khi biết (`field`: `rect`, `prop:<tên>`, `tag:<khe>`…). */
  | { editor: 'screen'; screen: string; item: string; field?: string }
  /** Alarm (feature 009): ô của lưới Danh sách alarm (`column` là khóa cột), hoặc dòng của bảng Khu vực. */
  | { editor: 'alarms'; row?: number; column?: string; area?: number }
  /** Lớp alarm: dòng và khóa trường. */
  | { editor: 'alarmClasses'; row?: number; column?: string }
  /** logic.json (feature 011): đường dẫn của lỗi (`/rules/1/when`); editor Logic tìm nhóm, khối, ô. */
  | { editor: 'logic'; path: string }
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

/** Màn hình 0.3: `/items/N/...` → item và ô; đường dẫn khác (cấp màn hình) không có chỗ để tới. */
function locateItem(
  screen: ProjectOutline['screens'][number],
  seg: string[],
  issue: Pick<Issue, 'code' | 'message'>,
): Location {
  const i = seg[0] === 'items' ? index(seg[1]) : null;
  const item = i === null ? undefined : screen.model?.items[i];
  if (!item) return NONE;
  let field = itemField(seg.slice(2));
  // Thiếu Tag bắt buộc: bộ kiểm tra trỏ vào cả item (khe chưa có khóa); tên khe nằm trong câu báo.
  if (field === null && issue.code === 'E_WIDGET_SLOT') {
    const slot = /^slot '([^']+)'/.exec(issue.message)?.[1];
    if (slot) field = `tag:${slot}`;
  }
  return { editor: 'screen', screen: screen.id, item: item.id, ...(field ? { field } : {}) };
}

/** Phần đường dẫn sau `/items/N` → ô inspector. */
export function itemField(rest: readonly string[]): string | null {
  switch (rest[0]) {
    case 'x':
    case 'y':
    case 'width':
    case 'height':
      return 'rect';
    case 'props':
      return rest[1] ? `prop:${rest[1]}` : null;
    case 'tags':
      return rest[1] ? `tag:${rest[1]}` : null;
    case 'events':
      return 'event';
    case 'security':
      return 'security';
    default:
      return null;
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

  const table = outline.valueTables.find((v) => v.file === issue.file);
  if (table) {
    if (seg[0] === 'default')
      return {
        editor: 'valueTable',
        name: table.name,
        entry: table.doc?.entries.length ?? 0,
        column: 'text',
      };
    const e = seg[0] === 'entries' ? index(seg[1]) : null;
    return e === null
      ? { editor: 'valueTable', name: table.name }
      : { editor: 'valueTable', name: table.name, entry: e };
  }

  if (outline.alarmFile !== null && issue.file === outline.alarmFile) {
    const tg = issueCell(issue);
    if (tg.kind === 'cell') return { editor: 'alarms', row: tg.row, column: tg.col };
    if (tg.kind === 'row') return { editor: 'alarms', row: tg.row, column: 'id' };
    if (tg.kind === 'area') return { editor: 'alarms', area: tg.row };
    return { editor: 'alarms' };
  }
  if (outline.alarmClassFile !== null && issue.file === outline.alarmClassFile) {
    const tg = issueCell(issue);
    return tg.kind === 'class'
      ? { editor: 'alarmClasses', row: tg.row, column: tg.field ?? 'id' }
      : { editor: 'alarmClasses' };
  }

  if (issue.file === 'project.json')
    return seg.length ? { editor: 'settings', field: seg[0] } : NONE;

  if (outline.logicFile !== null && issue.file === outline.logicFile)
    return { editor: 'logic', path: issue.path };

  if (outline.loggingFile !== null && issue.file === outline.loggingFile) {
    const i = index(seg[1]);
    if (seg[0] === 'groups' && i !== null) return { editor: 'logging', group: i };
    if (seg[0] === 'connections' && i !== null) return { editor: 'logging', connection: i };
    return { editor: 'logging' };
  }

  if (outline.reportsFile !== null && issue.file === outline.reportsFile) {
    const i = seg[0] === 'reports' ? index(seg[1]) : null;
    const id = i === null ? undefined : outline.reports?.reports[i]?.id;
    if (typeof id !== 'string') return NONE;
    const c = seg[2] === 'columns' ? index(seg[3]) : null;
    return c === null ? { editor: 'report', id } : { editor: 'report', id, column: c };
  }

  const screen03 = outline.screens.find((s) => s.model !== null && s.file === issue.file);
  if (screen03) return locateItem(screen03, seg, issue);

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
