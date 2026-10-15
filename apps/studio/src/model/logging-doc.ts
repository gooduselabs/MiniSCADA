// Mô hình tài liệu của editor Lưu trữ (feature 010, FR-046…FR-054; contracts/studio-010.md §1): hàm thuần trên
// `LoggingConfig` (không sửa đầu vào, trả bản mới) cho nhóm, Tag, kết nối. Editor áp kết quả bằng MỘT sửa đổi
// `{ kind: 'logging', value }` (project-doc) nên mỗi thao tác là một bước hoàn tác; giá trị sai vẫn ghi được
// (kiểm tra không chặn lưu, FR-054). Tên "Kết hợp" là `onChange` có `maxIntervalMs` (D2): Studio không thêm giá
// trị `mode` mới. Ước tính ghi tính bằng `estimateLogging` của @mat/project-schema (Constitution II).
import type {
  Connection,
  LoggedTag,
  LoggingConfig,
  LoggingGroup,
  LoggingTrigger,
  TagDataType,
  TagList,
} from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import type { ProjectEdit } from './project-doc.ts';

export type DisplayMode = 'cyclic' | 'onChange' | 'combined' | 'trigger';

export const MAX_TAGS_PER_GROUP = 200;
export const DEFAULT_PERIOD_MS = 1000;
export const DEFAULT_MAX_INTERVAL_MS = 60_000;
export const DEFAULT_STRING_LENGTH = 64;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Sửa đổi project-doc: thay cả logging.json. */
export const loggingEdit = (value: LoggingConfig): ProjectEdit => ({ kind: 'logging', value });

export function displayModeOf(g: LoggingGroup): DisplayMode {
  if (g.mode === 'cyclic') return 'cyclic';
  if (g.mode === 'trigger') return 'trigger';
  return g.maxIntervalMs !== undefined ? 'combined' : 'onChange';
}

/** Kiểu Tag theo id (từ danh sách Tag của project); kiểu lạ bỏ qua. */
export function tagTypesOf(
  tags: TagList | { tags: readonly { id?: unknown; type?: unknown }[] } | null | undefined,
): Map<string, TagDataType> {
  const out = new Map<string, TagDataType>();
  for (const t of tags?.tags ?? []) {
    const x = t as { id?: unknown; type?: unknown };
    if (typeof x.id === 'string' && typeof x.type === 'string')
      out.set(x.id, x.type as TagDataType);
  }
  return out;
}

/** Trường của Tag trong nhóm áp dụng được cho kiểu Tag (ô mờ khi không); kiểu chưa biết thì cho phép. */
export function applicable(
  type: TagDataType | undefined,
  field: 'deadband' | 'maxLength' | 'aggregate',
): boolean {
  if (type === undefined) return field !== 'maxLength';
  if (field === 'deadband') return type !== 'BOOL' && type !== 'STRING';
  if (field === 'maxLength') return type === 'STRING';
  return type !== 'STRING';
}

// ---- nhóm ----------------------------------------------------------------------------------------------------

function uniqueId(cfg: LoggingConfig, base: string): string {
  const used = new Set(cfg.groups.map((g) => g.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function addGroup(cfg: LoggingConfig): LoggingConfig {
  const next = clone(cfg);
  const id = uniqueId(next, 'nhom');
  next.groups.push({
    id,
    name: t('hist.group.default', { n: next.groups.length + 1 }),
    mode: 'cyclic',
    periodMs: DEFAULT_PERIOD_MS,
    retentionDays: 30,
    tags: [],
  });
  return next;
}

export function duplicateGroup(cfg: LoggingConfig, index: number): LoggingConfig {
  const src = cfg.groups[index];
  if (!src) return cfg;
  const next = clone(cfg);
  const copy = clone(src);
  copy.id = uniqueId(next, src.id);
  copy.name = t('hist.group.copy', { name: src.name });
  delete copy.table; // bảng mặc định theo id mới; giữ table cũ sẽ trùng (E_LOG_TABLE)
  next.groups.splice(index + 1, 0, copy);
  return next;
}

export function removeGroup(cfg: LoggingConfig, index: number): LoggingConfig {
  if (!cfg.groups[index]) return cfg;
  const next = clone(cfg);
  next.groups.splice(index, 1);
  return next;
}

type GroupNumberField =
  'retentionDays' | 'periodMs' | 'minIntervalMs' | 'maxIntervalMs' | 'expectedRowsPerDay';

/** Đặt (hoặc xóa khi `undefined`) một trường của nhóm. */
export function setGroupField(
  cfg: LoggingConfig,
  index: number,
  field: 'id' | 'name' | 'table' | GroupNumberField,
  value: string | number | undefined,
): LoggingConfig {
  if (!cfg.groups[index]) return cfg;
  const next = clone(cfg);
  const g = next.groups[index]! as unknown as Record<string, unknown>;
  if (value === undefined) delete g[field];
  else g[field] = value;
  return next;
}

/** Đổi chế độ hiển thị: đặt đúng các trường của chế độ mới và bỏ trường của chế độ cũ. */
export function setDisplayMode(g: LoggingGroup, mode: DisplayMode): LoggingGroup {
  const next = clone(g);
  switch (mode) {
    case 'cyclic':
      next.mode = 'cyclic';
      next.periodMs ??= DEFAULT_PERIOD_MS;
      delete next.minIntervalMs;
      delete next.maxIntervalMs;
      delete next.expectedRowsPerDay;
      delete next.trigger;
      break;
    case 'onChange':
      next.mode = 'onChange';
      delete next.periodMs;
      delete next.maxIntervalMs;
      delete next.trigger;
      break;
    case 'combined':
      next.mode = 'onChange';
      delete next.periodMs;
      delete next.trigger;
      next.maxIntervalMs ??= DEFAULT_MAX_INTERVAL_MS;
      break;
    case 'trigger':
      next.mode = 'trigger';
      delete next.periodMs;
      delete next.maxIntervalMs;
      next.trigger ??= { tagId: g.tags[0]?.tagId ?? '', edge: 'rising' };
      break;
  }
  return next;
}

/** Sửa một phần của `trigger`; `edge = active` cần `periodMs`, các cạnh khác bỏ `periodMs`. */
export function setTrigger(g: LoggingGroup, patch: Partial<LoggingTrigger>): LoggingGroup {
  const next = clone(g);
  const cur: LoggingTrigger = next.trigger ?? { tagId: '', edge: 'rising' };
  const merged = { ...cur, ...patch } as LoggingTrigger;
  if ('threshold' in patch && patch.threshold === undefined) delete merged.threshold;
  next.trigger = merged;
  if (merged.edge === 'active') next.periodMs ??= DEFAULT_PERIOD_MS;
  else delete next.periodMs;
  return next;
}

/** Áp `setDisplayMode`/`setTrigger` cho nhóm ở `index` của cấu hình. */
export function mapGroup(
  cfg: LoggingConfig,
  index: number,
  fn: (g: LoggingGroup) => LoggingGroup,
): LoggingConfig {
  const g = cfg.groups[index];
  if (!g) return cfg;
  const next = clone(cfg);
  next.groups[index] = fn(clone(g));
  return next;
}

/** Bật tổng hợp (`{}` = mặc định 31 ngày phút, 730 ngày giờ) hoặc tắt. */
export function setAggregates(
  cfg: LoggingConfig,
  index: number,
  on: boolean,
  retention?: { minuteRetentionDays?: number; hourRetentionDays?: number },
): LoggingConfig {
  if (!cfg.groups[index]) return cfg;
  const next = clone(cfg);
  const g = next.groups[index]!;
  if (!on) delete g.aggregates;
  else {
    const merged = { ...(g.aggregates ?? {}), ...(retention ?? {}) };
    for (const k of Object.keys(merged) as Array<keyof typeof merged>)
      if (merged[k] === undefined) delete merged[k];
    g.aggregates = merged;
  }
  return next;
}

// ---- Tag của nhóm --------------------------------------------------------------------------------------------

/** Thêm Tag (kéo từ cây): bỏ Tag trùng, giữ thứ tự, tối đa 200; Tag chuỗi có độ dài mặc định. */
export function addTags(
  cfg: LoggingConfig,
  index: number,
  tagIds: readonly string[],
  types: ReadonlyMap<string, TagDataType>,
): LoggingConfig {
  if (!cfg.groups[index]) return cfg;
  const next = clone(cfg);
  const g = next.groups[index]!;
  const have = new Set(g.tags.map((t) => t.tagId));
  for (const id of tagIds) {
    if (have.has(id) || g.tags.length >= MAX_TAGS_PER_GROUP) continue;
    have.add(id);
    const lt: LoggedTag = { tagId: id };
    if (types.get(id) === 'STRING') lt.maxLength = DEFAULT_STRING_LENGTH;
    g.tags.push(lt);
  }
  return next;
}

export function removeTags(
  cfg: LoggingConfig,
  index: number,
  rows: readonly number[],
): LoggingConfig {
  if (!cfg.groups[index]) return cfg;
  const drop = new Set(rows);
  const next = clone(cfg);
  next.groups[index]!.tags = next.groups[index]!.tags.filter((_, i) => !drop.has(i));
  return next;
}

export function setTagField(
  cfg: LoggingConfig,
  group: number,
  row: number,
  field: 'tagId' | 'column' | 'deadband' | 'maxLength' | 'aggregate',
  value: string | number | boolean | undefined,
): LoggingConfig {
  if (!cfg.groups[group]?.tags[row]) return cfg;
  const next = clone(cfg);
  const t = next.groups[group]!.tags[row]! as unknown as Record<string, unknown>;
  if (value === undefined) delete t[field];
  else t[field] = value;
  return next;
}

// ---- kết nối (không có mật khẩu: nhập trên thiết bị, `--set-secret`) -----------------------------------------

export function upsertConnection(cfg: LoggingConfig, conn: Connection): LoggingConfig {
  const next = clone(cfg);
  const list = (next.connections ??= []);
  const i = list.findIndex((c) => c.id === conn.id);
  if (i >= 0) list[i] = clone(conn);
  else list.push(clone(conn));
  return next;
}

export function removeConnection(cfg: LoggingConfig, id: string): LoggingConfig {
  const next = clone(cfg);
  next.connections = (next.connections ?? []).filter((c) => c.id !== id);
  for (const g of next.groups) {
    if (!g.destinations) continue;
    g.destinations = g.destinations.filter((d) => d !== id);
    if (g.destinations.length === 0) delete g.destinations;
  }
  return next;
}
