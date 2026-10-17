// Tài liệu project của Studio: sửa project.json, file Tag và (định dạng 0.2) kết nối, bảng giá trị, bảng theo dõi trên
// bản sao, giữ thứ tự khóa và trường không chạm (FR-022, khắc phục FR-033 của audit Sprint 1), ghi theo định dạng
// chuẩn: JSON 2 dấu cách; tags.json của 0.2 mỗi Tag một dòng (format-02, research R2).
// Phần đầu là các sửa đổi (applyProjectEdits); phần "Feature 004" là tài liệu đang mở, thứ tự ghi, snapshot cho lịch
// sử và cấu trúc project đọc được. Feature 006 (data-model §13.1): sửa đổi cho Tag v1, kênh, thiết bị trường, nhóm
// quét, bảng giá trị, bảng theo dõi và `batch` (một bước hoàn tác); file mới tạo khi có nội dung đầu tiên, bảng bị
// xóa thì file bị xóa khi lưu.
import {
  formatAlarmClassesFile,
  formatAlarmsFile,
  formatProject03,
  formatScreen03,
  formatTagsFile,
  renameTableInExpression,
  stripBom,
  type AlarmClassesFile,
  type AlarmsFile,
  type BindingSet,
  type BindingSet03,
  type BindingSet04,
  type Navigation,
  type Project03,
  type ScreenModel,
  type Channel,
  type ConnectionsConfig,
  type ReportsConfig,
  type FieldDevice,
  type LoggingConfig,
  type Project,
  type Screen,
  type TagDefinition,
  type TagList,
  type TagListV1,
  type TagV1,
  type TemplateDoc,
  type LogicDoc,
  type ValueTableDoc,
  type WatchTableDoc,
} from '@mat/project-schema';

export type ProjectField = 'projectName' | 'projectVersion' | 'entryScreen' | 'maxClients';

/** Khóa của Tag 0.1 theo thứ tự file chuẩn (data-model của 004 §3.1); cũng là các cột của Bảng Tag 0.1. */
export const TAG_KEY_ORDER = ['id', 'type', 'description', 'unit', 'min', 'max', 'source'] as const;
export type TagField = (typeof TAG_KEY_ORDER)[number];

/** Khóa của Tag v1 (0.2) theo thứ tự file chuẩn (data-model §1); khóa của Tag 0.1 là dãy con của dãy này. */
export const TAG_KEY_ORDER_V1 = [
  'id',
  'kind',
  'type',
  'description',
  'unit',
  'min',
  'max',
  'access',
  'limits',
  'valueTable',
  'deadband',
  'source',
  'scaling',
  'initial',
  'retain',
  'expression',
  'sim',
] as const;
export type TagFieldV1 = (typeof TAG_KEY_ORDER_V1)[number];

/** Tag như Studio thấy: 0.1 hoặc v1 (đọc `id`, `type`, `description`, `unit`, `min`, `max` chung được). */
export type AnyTag = TagDefinition | TagV1;

export type ProjectEdit =
  | { kind: 'project'; field: ProjectField; value: string | number }
  /**
   * Đặt nhiều khóa của project.json một lần (So sánh › Đọc lên phần chọn, feature 005); `undefined` thì bỏ khóa.
   * Khóa đã có giữ chỗ, khóa mới thêm ở cuối.
   */
  | { kind: 'projectPatch'; fields: Readonly<Record<string, unknown>> }
  | { kind: 'tagUpsert'; index?: number; tag: AnyTag }
  | { kind: 'tagRemove'; index: number }
  /** Gán một trường của Tag (Bảng Tag); `value` undefined thì bỏ khóa. Trường v1 có thể là cả đối tượng (`source`). */
  | { kind: 'tagField'; index: number; field: TagField | TagFieldV1; value?: unknown }
  // ---- Feature 006 ----
  | { kind: 'channelUpsert'; index?: number; channel: Channel }
  | { kind: 'channelRemove'; index: number }
  | { kind: 'deviceUpsert'; channel: number; index?: number; device: FieldDevice }
  | { kind: 'deviceRemove'; channel: number; index: number }
  /** Chu kỳ nhóm quét; `undefined` thì bỏ khóa `scanGroups` (về mặc định). */
  | { kind: 'scanGroups'; value: ConnectionsConfig['scanGroups'] | undefined }
  /** Thêm hoặc thay bảng giá trị theo `name`; bảng mới tạo file và thêm tên vào project.json. */
  | { kind: 'valueTableUpsert'; table: ValueTableDoc }
  | { kind: 'valueTableRemove'; name: string }
  /** Đổi tên bảng: file mới, file cũ bị xóa; `valueTable` của Tag dùng bảng đổi theo. */
  | { kind: 'valueTableRename'; from: string; to: string }
  | { kind: 'watchTableUpsert'; table: WatchTableDoc }
  | { kind: 'watchTableRemove'; id: string }
  // ---- Feature 007 (định dạng 0.3) ----
  /** Thêm hoặc thay cả một màn hình 0.3 theo `id`; màn hình mới tạo file và thêm id vào project.json. */
  | { kind: 'screenUpsert'; screen: ScreenModel }
  /** Xóa màn hình: id khỏi project.json, file bị xóa khi lưu (SVG và binding giữ trên đĩa). */
  | { kind: 'screenRemove'; id: string }
  /** Đặt khối `navigation` của project.json; `undefined` thì bỏ khóa. */
  | { kind: 'navigation'; value: Navigation | undefined }
  // ---- Feature 009 (định dạng 0.5): alarm ----
  /**
   * Thay cả `alarms.json` (khu vực và alarm); lần đầu tạo file và thêm `alarmFile` vào project.json. `undefined` thì
   * bỏ file và khóa.
   */
  | { kind: 'alarmsSet'; doc: AlarmsFile | undefined }
  /** Thay cả `alarm-classes.json`; lần đầu tạo file và thêm `alarmClassFile`. */
  | { kind: 'alarmClassesSet'; doc: AlarmClassesFile | undefined }
  // ---- Feature 008 (định dạng 0.4) ----
  /** Đặt cả file binding của một item `svg` (`screens/<màn hình>.<item>.bindings.json`); `undefined` thì xóa file. */
  | { kind: 'svgBindings'; file: string; set: BindingSet04 | undefined }
  /** Gộp nhiều sửa đổi thành một bước hoàn tác (dán, điền, nhập CSV, thêm hàng loạt, đổi tên Tag). */
  // ---- Feature 010 (định dạng 0.6) ----
  /** Thay cả cấu hình lưu trữ (logging.json); file mới tạo khi chưa có và project.json nhận `loggingFile`. */
  | { kind: 'logging'; value: LoggingConfig }
  /** Thay cả file mẫu báo cáo (reports.json); project.json nhận `reportsFile` khi chưa có. */
  | { kind: 'reports'; value: ReportsConfig }
  // ---- Feature 011 (định dạng 1.0): template ----
  /** Thêm hoặc thay cả `templates/<id>.template.json`; template mới tạo file và thêm đường dẫn vào `project.json › templates`. */
  | { kind: 'templateUpsert'; template: TemplateDoc }
  /** Xóa template: đường dẫn khỏi `templates` (hết thì bỏ khóa), file bị xóa khi lưu. Bản sao phải được bung trước. */
  | { kind: 'templateRemove'; id: string }
  // ---- Feature 011 (định dạng 1.0): logic ----
  /** Thay cả logic.json; lần đầu tạo `logic.json` và thêm `logic` vào project.json (editor Logic: mỗi lần sửa một bước hoàn tác). */
  | { kind: 'logicSet'; doc: LogicDoc }
  | { kind: 'batch'; edits: readonly ProjectEdit[] };

export interface EditableProject {
  project: Project;
  tags: TagList | TagListV1;
  /** Định dạng 0.2: thiếu nghĩa là chưa có file kết nối. */
  connections?: ConnectionsConfig | null;
  valueTables?: Record<string, ValueTableDoc>;
  watchTables?: Record<string, WatchTableDoc>;
  /** Màn hình 0.3 theo id (sửa được); 0.1 và 0.2 không có. */
  screens?: Record<string, ScreenModel>;
  /** Định dạng 0.5: hai file alarm (thiếu nghĩa là project chưa có alarm). */
  alarms?: AlarmsFile | null;
  alarmClasses?: AlarmClassesFile | null;
  /** Binding của item `svg` theo đường dẫn file (feature 008). */
  svgBindings?: Record<string, BindingSet04>;
  /** Định dạng 0.6: lưu trữ và mẫu báo cáo (sửa được); thiếu nghĩa là chưa có file. */
  logging?: LoggingConfig | null;
  reports?: ReportsConfig | null;
  /** Định dạng 1.0: template theo id (tệp `templates/<id>.template.json` khai ở project.json). */
  templates?: Record<string, TemplateDoc>;
  /** Định dạng 1.0: logic.json (thiếu: project chưa có logic). */
  logic?: LogicDoc | null;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const CONNECTIONS_FILE = 'connections.json';
export const LOGGING_FILE = 'logging.json';
export const REPORTS_FILE = 'reports.json';
export const LOGIC_FILE = 'logic.json';
export const valueTableFile = (name: string): string => `value-tables/${name}.json`;
export const watchTableFile = (id: string): string => `watch-tables/${id}.json`;
export const screenFile = (id: string): string => `screens/${id}.screen.json`;
export const templateFile = (id: string): string => `templates/${id}.template.json`;
const TEMPLATE_REL = /^templates\/([a-z][a-z0-9-]{0,47})\.template\.json$/;
export const ALARMS_FILE = 'alarms.json';
export const ALARM_CLASSES_FILE = 'alarm-classes.json';
const SCREEN_REL = /^screens\/[^/]+\.screen\.json$/;

/** Phần của EditableProject mà một lần áp sửa đổi đã chạm tới (để chỉ ghi lại tài liệu cần). */
export interface Touched {
  project: boolean;
  tags: boolean;
  connections: boolean;
  valueTables: Set<string>;
  watchTables: Set<string>;
  screens: Set<string>;
  alarms: boolean;
  alarmClasses: boolean;
  svgBindings: Set<string>;
  logging: boolean;
  reports: boolean;
  templates: Set<string>;
  logic: boolean;
}

const newTouched = (): Touched => ({
  project: false,
  tags: false,
  connections: false,
  valueTables: new Set(),
  watchTables: new Set(),
  screens: new Set(),
  alarms: false,
  alarmClasses: false,
  svgBindings: new Set(),
  logging: false,
  reports: false,
  templates: new Set(),
  logic: false,
});

/** Áp các sửa đổi lên bản sao (không đụng bản gốc); giữ thứ tự khóa và trường không sửa. */
export function applyProjectEdits(base: EditableProject, edits: ProjectEdit[]): EditableProject {
  return applyEdits(base, edits).state;
}

/** Như `applyProjectEdits`, kèm các phần đã chạm tới. */
export function applyEdits(
  base: EditableProject,
  edits: readonly ProjectEdit[],
): { state: EditableProject; touched: Touched } {
  const state: EditableProject = {
    project: clone(base.project),
    tags: clone(base.tags),
    ...(base.connections !== undefined ? { connections: clone(base.connections) } : {}),
    ...(base.valueTables ? { valueTables: clone(base.valueTables) } : {}),
    ...(base.watchTables ? { watchTables: clone(base.watchTables) } : {}),
    ...(base.screens ? { screens: clone(base.screens) } : {}),
    ...(base.alarms !== undefined ? { alarms: clone(base.alarms) } : {}),
    ...(base.alarmClasses !== undefined ? { alarmClasses: clone(base.alarmClasses) } : {}),
    ...(base.svgBindings ? { svgBindings: clone(base.svgBindings) } : {}),
    ...(base.logging !== undefined ? { logging: clone(base.logging) } : {}),
    ...(base.reports !== undefined ? { reports: clone(base.reports) } : {}),
    ...(base.templates ? { templates: clone(base.templates) } : {}),
    ...(base.logic !== undefined ? { logic: clone(base.logic) } : {}),
  };
  const touched = newTouched();
  run(state, edits, touched);
  return { state, touched };
}

const tagListOf = (s: EditableProject): AnyTag[] | null =>
  isObject(s.tags) && Array.isArray((s.tags as { tags?: unknown }).tags)
    ? (s.tags as { tags: AnyTag[] }).tags
    : null;

/** Danh sách tên trong project.json (`valueTables`, `watchTables`), tạo khi chưa có. */
function listOf(project: Project, key: 'valueTables' | 'watchTables' | 'screens'): string[] | null {
  if (!isObject(project)) return null;
  const rec = project as unknown as Record<string, unknown>;
  if (!Array.isArray(rec[key])) rec[key] = [];
  return rec[key] as string[];
}

/** Bảo đảm có `connections` để sửa; project.json nhận `connectionFile` nếu chưa có. */
function ensureConnections(s: EditableProject, touched: Touched): ConnectionsConfig | null {
  if (!isObject(s.project)) return null;
  if (!s.connections) {
    s.connections = { schemaVersion: String(s.project.schemaVersion ?? '0.2.0'), channels: [] };
    if (typeof s.project.connectionFile !== 'string') {
      (s.project as unknown as Record<string, unknown>).connectionFile = CONNECTIONS_FILE;
      touched.project = true;
    }
  }
  touched.connections = true;
  if (!Array.isArray(s.connections.channels)) s.connections.channels = [];
  return s.connections;
}

function run(s: EditableProject, edits: readonly ProjectEdit[], touched: Touched): void {
  const tagList = tagListOf(s);
  for (const e of edits) {
    switch (e.kind) {
      case 'batch':
        run(s, e.edits, touched);
        break;
      case 'logging':
      case 'reports': {
        if (!isObject(s.project)) break;
        const key = e.kind === 'logging' ? 'loggingFile' : 'reportsFile';
        const rec = s.project as unknown as Record<string, unknown>;
        if (typeof rec[key] !== 'string') {
          rec[key] = e.kind === 'logging' ? LOGGING_FILE : REPORTS_FILE;
          touched.project = true;
        }
        if (e.kind === 'logging') {
          s.logging = clone(e.value);
          touched.logging = true;
        } else {
          s.reports = clone(e.value);
          touched.reports = true;
        }
        break;
      }
      case 'project':
        if (isObject(s.project))
          (s.project as unknown as Record<string, unknown>)[e.field] = e.value;
        touched.project = true;
        break;
      case 'projectPatch':
        if (isObject(s.project))
          patchObject(s.project as unknown as Record<string, unknown>, e.fields);
        touched.project = true;
        break;
      case 'tagUpsert':
        if (!tagList) break;
        if (e.index === undefined) tagList.push(clone(e.tag));
        else tagList[e.index] = clone(e.tag);
        touched.tags = true;
        break;
      case 'tagField': {
        if (!tagList) break;
        const cur: unknown = tagList[e.index];
        if (isObject(cur))
          tagList[e.index] = setTagField(cur as unknown as AnyTag, e.field, e.value);
        touched.tags = true;
        break;
      }
      case 'tagRemove':
        if (!tagList) break;
        tagList.splice(e.index, 1);
        touched.tags = true;
        break;
      case 'channelUpsert': {
        const c = ensureConnections(s, touched);
        if (!c) break;
        if (e.index === undefined || !c.channels[e.index]) c.channels.push(clone(e.channel));
        else c.channels[e.index] = clone(e.channel);
        break;
      }
      case 'channelRemove': {
        const c = ensureConnections(s, touched);
        c?.channels.splice(e.index, 1);
        break;
      }
      case 'deviceUpsert': {
        const ch = ensureConnections(s, touched)?.channels[e.channel];
        if (!ch) break;
        if (!Array.isArray(ch.devices)) ch.devices = [];
        if (e.index === undefined || !ch.devices[e.index]) ch.devices.push(clone(e.device));
        else ch.devices[e.index] = clone(e.device);
        break;
      }
      case 'deviceRemove': {
        const ch = ensureConnections(s, touched)?.channels[e.channel];
        ch?.devices?.splice(e.index, 1);
        break;
      }
      case 'scanGroups': {
        const c = ensureConnections(s, touched);
        if (!c) break;
        if (e.value === undefined) delete c.scanGroups;
        else c.scanGroups = clone(e.value);
        break;
      }
      case 'valueTableUpsert': {
        const list = listOf(s.project, 'valueTables');
        if (!list) break;
        s.valueTables ??= {};
        const name = e.table.name;
        if (!list.includes(name)) {
          list.push(name);
          touched.project = true;
        }
        s.valueTables[name] = clone(e.table);
        touched.valueTables.add(name);
        break;
      }
      case 'valueTableRemove': {
        const list = listOf(s.project, 'valueTables');
        if (!list) break;
        const i = list.indexOf(e.name);
        if (i >= 0) list.splice(i, 1);
        if (s.valueTables) delete s.valueTables[e.name];
        if (list.length === 0) delete (s.project as unknown as Record<string, unknown>).valueTables;
        touched.project = true;
        touched.valueTables.add(e.name);
        break;
      }
      case 'valueTableRename': {
        const list = listOf(s.project, 'valueTables');
        if (!list || !s.valueTables?.[e.from]) break;
        const table = { ...s.valueTables[e.from], name: e.to };
        delete s.valueTables[e.from];
        s.valueTables[e.to] = table;
        list.splice(list.indexOf(e.from), 1, e.to);
        touched.project = true;
        touched.valueTables.add(e.from).add(e.to);
        // Widget `select` của màn hình 0.3 dùng bảng theo `props.table` (feature 007, FR-069).
        for (const [id, scr] of Object.entries(s.screens ?? {})) {
          for (const item of scr.items) {
            if (item.type === 'widget' && item.props?.table === e.from) {
              item.props.table = e.to;
              touched.screens.add(id);
            }
          }
        }
        for (const tag of tagList ?? []) {
          if (!isObject(tag)) continue;
          if ((tag as TagV1).valueTable === e.from) {
            (tag as TagV1).valueTable = e.to;
            touched.tags = true;
          }
          // Biểu thức text(x, Bảng) dùng tên bảng: đổi theo để không thành lỗi "không có bảng".
          const expr = (tag as TagV1).expression;
          const next =
            typeof expr === 'string' ? renameTableInExpression(expr, e.from, e.to) : null;
          if (next !== null) {
            (tag as TagV1).expression = next;
            touched.tags = true;
          }
        }
        break;
      }
      case 'screenUpsert': {
        const list = listOf(s.project, 'screens');
        if (!list) break;
        s.screens ??= {};
        if (!list.includes(e.screen.id)) {
          list.push(e.screen.id);
          touched.project = true;
        }
        s.screens[e.screen.id] = clone(e.screen);
        touched.screens.add(e.screen.id);
        break;
      }
      case 'screenRemove': {
        const list = listOf(s.project, 'screens');
        if (!list) break;
        const i = list.indexOf(e.id);
        if (i >= 0) list.splice(i, 1);
        if (s.screens) delete s.screens[e.id];
        touched.project = true;
        touched.screens.add(e.id);
        break;
      }
      case 'alarmsSet':
      case 'alarmClassesSet': {
        if (!isObject(s.project)) break;
        const rec = s.project as unknown as Record<string, unknown>;
        const isAlarms = e.kind === 'alarmsSet';
        const key = isAlarms ? 'alarmFile' : 'alarmClassFile';
        if (e.doc === undefined) {
          delete rec[key];
          if (isAlarms) s.alarms = null;
          else s.alarmClasses = null;
        } else {
          if (typeof rec[key] !== 'string') rec[key] = isAlarms ? ALARMS_FILE : ALARM_CLASSES_FILE;
          if (isAlarms) s.alarms = clone(e.doc as AlarmsFile);
          else s.alarmClasses = clone(e.doc as AlarmClassesFile);
        }
        touched.project = true;
        if (isAlarms) touched.alarms = true;
        else touched.alarmClasses = true;
        break;
      }
      case 'templateUpsert': {
        if (!isObject(s.project)) break;
        const rec = s.project as unknown as Record<string, unknown>;
        if (!Array.isArray(rec.templates)) rec.templates = [];
        const list = rec.templates as string[];
        const file = templateFile(e.template.id);
        if (!list.includes(file)) {
          list.push(file);
          touched.project = true;
        }
        s.templates ??= {};
        s.templates[e.template.id] = clone(e.template);
        touched.templates.add(e.template.id);
        break;
      }
      case 'templateRemove': {
        if (!isObject(s.project)) break;
        const rec = s.project as unknown as Record<string, unknown>;
        const list = Array.isArray(rec.templates) ? (rec.templates as string[]) : [];
        const i = list.indexOf(templateFile(e.id));
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) delete rec.templates;
        if (s.templates) delete s.templates[e.id];
        touched.project = true;
        touched.templates.add(e.id);
        break;
      }
      case 'logicSet': {
        if (!isObject(s.project)) break;
        const rec = s.project as unknown as Record<string, unknown>;
        if (typeof rec.logic !== 'string') {
          rec.logic = LOGIC_FILE;
          touched.project = true;
        }
        s.logic = clone(e.doc);
        touched.logic = true;
        break;
      }
      case 'svgBindings': {
        s.svgBindings ??= {};
        if (e.set === undefined) delete s.svgBindings[e.file];
        else s.svgBindings[e.file] = clone(e.set);
        touched.svgBindings.add(e.file);
        break;
      }
      case 'navigation': {
        if (!isObject(s.project)) break;
        const rec = s.project as unknown as Record<string, unknown>;
        if (e.value === undefined) delete rec.navigation;
        else rec.navigation = clone(e.value);
        touched.project = true;
        break;
      }
      case 'watchTableUpsert': {
        const list = listOf(s.project, 'watchTables');
        if (!list) break;
        s.watchTables ??= {};
        if (!list.includes(e.table.id)) {
          list.push(e.table.id);
          touched.project = true;
        }
        s.watchTables[e.table.id] = clone(e.table);
        touched.watchTables.add(e.table.id);
        break;
      }
      case 'watchTableRemove': {
        const list = listOf(s.project, 'watchTables');
        if (!list) break;
        const i = list.indexOf(e.id);
        if (i >= 0) list.splice(i, 1);
        if (s.watchTables) delete s.watchTables[e.id];
        if (list.length === 0) delete (s.project as unknown as Record<string, unknown>).watchTables;
        touched.project = true;
        touched.watchTables.add(e.id);
        break;
      }
    }
  }
}

/** Gán, hoặc bỏ (`undefined`) các khóa của `target` tại chỗ. */
function patchObject(
  target: Record<string, unknown>,
  fields: Readonly<Record<string, unknown>>,
): void {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete target[k];
    else target[k] = clone(v);
  }
}

const keyRank = (k: string): number => {
  const i = (TAG_KEY_ORDER_V1 as readonly string[]).indexOf(k);
  return i < 0 ? TAG_KEY_ORDER_V1.length : i;
};

/** Tag theo thứ tự khóa chuẩn; trường undefined bỏ đi, khóa lạ (nếu có) đứng sau theo thứ tự cũ. */
export function canonicalTag(tag: Partial<TagDefinition>): TagDefinition {
  const entries = Object.entries(tag).filter(([, v]) => v !== undefined);
  entries.sort((a, b) => keyRank(a[0]) - keyRank(b[0]));
  return Object.fromEntries(entries.map(([k, v]) => [k, clone(v)])) as unknown as TagDefinition;
}

/**
 * Gán một trường của Tag trên bản sao: khóa đã có giữ chỗ; khóa mới chèn ngay sau khóa đứng trước nó
 * theo thứ tự chuẩn; `undefined` thì bỏ khóa. Các trường khác giữ nguyên (kể cả chuỗi rỗng).
 */
export function setTagField<T extends AnyTag>(tag: T, field: string, value: unknown): T {
  const entries = Object.entries(tag);
  const i = entries.findIndex(([k]) => k === field);
  if (value === undefined) {
    if (i >= 0) entries.splice(i, 1);
  } else if (i >= 0) {
    entries[i] = [field, clone(value)];
  } else {
    let at = 0;
    entries.forEach(([k], j) => {
      if (keyRank(k) < keyRank(field)) at = j + 1;
    });
    entries.splice(at, 0, [field, clone(value)]);
  }
  return Object.fromEntries(entries) as unknown as T;
}

/** Định dạng chuẩn của file project do Studio ghi (cũng là định dạng của project mẫu). */
export const serialize = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

// ---------------------------------------------------------------------------------------------
// Feature 004: tài liệu đang mở (data-model §3.1)

/**
 * `tags02`: file Tag của project 0.2/0.3, mỗi Tag một dòng (format-02); `screen03`: màn hình 0.3, mỗi item một dòng
 * (format-03); `project03`: project.json 0.3 (khối `navigation` gọn).
 */
export type DocFormat =
  | 'tags02'
  | 'screen03'
  | 'project03'
  /** `alarms.json`, `alarm-classes.json` của 0.5: mỗi khu vực, alarm, lớp một dòng gọn (format-05). */
  | 'alarms05'
  | 'alarmClasses05';

/** Một file của project đang mở. Bất biến: mỗi lần sửa tạo tài liệu mới (withValue). */
export interface ProjectDoc {
  /** Đường dẫn tương đối trong project (`project.json`, `tags.json`, `screens/...`). */
  readonly rel: string;
  /** Nội dung đọc từ đĩa, nguyên văn (giữ BOM nếu có). */
  readonly diskText: string;
  /** SHA-256 của diskText do Rust trả (contracts/tauri-commands.md); null khi nguồn đọc không có. */
  readonly diskHash: string | null;
  /**
   * Chuỗi chuẩn (serialize) của nội dung trên đĩa. Với file ở định dạng chuẩn (file mẫu, file Studio
   * đã ghi) chính là diskText; file viết tay khác định dạng thì mở ra vẫn không bị coi là chưa lưu.
   */
  readonly cleanText: string;
  /** Đối tượng đang sửa; null khi file không phải JSON hợp lệ (ví dụ JSON hỏng, SVG). */
  readonly value: unknown;
  /** Sửa được theo đối tượng (data-model §13.1), và chỉ khi JSON đọc được. */
  readonly editable: boolean;
  /**
   * Nội dung chờ ghi (feature 005, FR-030): cả file lấy từ thiết bị (So sánh › Đọc lên phần chọn) cho file không
   * sửa được theo đối tượng (lưu trữ, màn hình, binding, SVG). Có thì Lưu ghi đúng chuỗi này; khác `diskText` thì
   * là chưa lưu.
   */
  readonly pending?: string;
  /**
   * File chưa có trên đĩa: ghi với hash `null`; hoàn tác thì bỏ cả tài liệu. Với tài liệu sửa được (bảng giá trị,
   * bảng theo dõi, kết nối mới) hoặc nội dung chờ ghi (đọc lên từ thiết bị).
   */
  readonly created?: true;
  /** Cách ghi file; vắng thì JSON 2 dấu cách. */
  readonly fmt?: DocFormat;
  /** Bảng đã xóa (feature 006): file bị xóa khi lưu; tài liệu vẫn ở lại để hoàn tác khôi phục được. */
  readonly removed?: true;
}

/** Tập tài liệu theo đường dẫn tương đối. */
export type ProjectDocs = Readonly<Record<string, ProjectDoc>>;

/** Chuỗi chuẩn của một giá trị theo cách ghi của file. Giá trị sai hình dạng thì ghi JSON thường. */
function renderValue(value: unknown, fmt: DocFormat | undefined): string {
  if (fmt === 'tags02' && isObject(value) && Array.isArray(value.tags))
    return formatTagsFile(value as unknown as TagListV1);
  if (fmt === 'screen03' && isObject(value) && Array.isArray(value.items))
    return formatScreen03(value as unknown as ScreenModel);
  if (fmt === 'project03' && isObject(value)) return formatProject03(value as unknown as Project03);
  if (fmt === 'alarms05' && isObject(value) && Array.isArray(value.alarms))
    return formatAlarmsFile(value as unknown as AlarmsFile);
  if (fmt === 'alarmClasses05' && isObject(value) && Array.isArray(value.classes))
    return formatAlarmClassesFile(value as unknown as AlarmClassesFile);
  return serialize(value);
}

export function loadDoc(
  rel: string,
  text: string,
  hash: string | null,
  editable: boolean,
  fmt?: DocFormat,
): ProjectDoc {
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch {
    value = null; // JSON hỏng: bộ kiểm tra báo E_JSON
  }
  const ok = value !== null && typeof value === 'object';
  return {
    rel,
    diskText: text,
    diskHash: hash,
    cleanText: ok ? renderValue(value, fmt) : '',
    value: ok ? value : null,
    editable: editable && ok,
    ...(fmt ? { fmt } : {}),
  };
}

/** Tài liệu sửa được mới, chưa có trên đĩa: dirty ngay (có nội dung đầu tiên). */
export const newEditableDoc = (rel: string, value: unknown, fmt?: DocFormat): ProjectDoc => ({
  rel,
  diskText: '',
  diskHash: null,
  cleanText: '',
  value,
  editable: true,
  created: true,
  ...(fmt ? { fmt } : {}),
});

/** Chuỗi sẽ ghi xuống đĩa khi Lưu (và bộ kiểm tra thấy). */
export const writtenText = (doc: ProjectDoc): string =>
  doc.pending !== undefined ? doc.pending : renderValue(doc.value, doc.fmt);

/**
 * Chưa lưu: chuỗi sẽ ghi khác nội dung trên đĩa. Tài liệu sửa được so chuỗi chuẩn với `cleanText` (sửa về như cũ thì
 * hết); nội dung chờ ghi so với `diskText`; bảng đã xóa luôn chưa lưu (file còn trên đĩa).
 */
export const isDirty = (doc: ProjectDoc): boolean =>
  doc.removed
    ? true
    : doc.pending !== undefined
      ? doc.pending !== doc.diskText
      : doc.editable && doc.value !== null && renderValue(doc.value, doc.fmt) !== doc.cleanText;

const parseValue = (text: string): unknown => {
  try {
    const v: unknown = JSON.parse(stripBom(text));
    return v !== null && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

/** Đặt nội dung chờ ghi (cả file); `value` theo nội dung mới để cây, xref, kiểm tra thấy ngay. */
export const withPending = (doc: ProjectDoc, text: string): ProjectDoc => ({
  ...doc,
  pending: text,
  value: parseValue(text),
});

/** File chưa có trên máy: tài liệu mới chỉ gồm nội dung chờ ghi. */
export const newPendingDoc = (rel: string, text: string): ProjectDoc => ({
  rel,
  diskText: '',
  diskHash: null,
  cleanText: '',
  value: parseValue(text),
  editable: false,
  pending: text,
  created: true,
});

/** Bản sao của tài liệu không có nội dung chờ ghi. */
const settled = (doc: ProjectDoc): ProjectDoc => {
  const out: { -readonly [K in keyof ProjectDoc]: ProjectDoc[K] } = { ...doc };
  delete out.pending;
  delete out.created;
  return out;
};

/** Bỏ nội dung chờ ghi: về đúng nội dung trên đĩa. */
const withoutPending = (doc: ProjectDoc): ProjectDoc => ({
  ...settled(doc),
  value: parseValue(doc.diskText),
});

export const withValue = (doc: ProjectDoc, value: unknown): ProjectDoc => ({ ...doc, value });

/** Sau khi ghi xong `written` (đúng chuỗi đã ghi) với hash mới; value giữ nguyên. */
export const markSaved = (doc: ProjectDoc, written: string, hash: string | null): ProjectDoc => ({
  ...settled(doc),
  diskText: written,
  diskHash: hash,
  cleanText: written,
});

/** File Tag của project (project.json › tagFile), mặc định `tags.json`. */
export function tagFileOf(docs: ProjectDocs): string {
  const p = docs['project.json']?.value;
  return isObject(p) && typeof p.tagFile === 'string' ? p.tagFile : 'tags.json';
}

/** File kết nối của project 0.2 (project.json › connectionFile); `null` khi chưa có. */
export function connectionFileOf(docs: ProjectDocs): string | null {
  const p = docs['project.json']?.value;
  return isObject(p) && typeof p.connectionFile === 'string' ? p.connectionFile : null;
}

/** File alarm, lớp alarm của project 0.5 (project.json › alarmFile, alarmClassFile); `null` khi chưa khai. */
export function alarmFileOf(docs: ProjectDocs): string | null {
  const p = docs['project.json']?.value;
  return isObject(p) && typeof p.alarmFile === 'string' ? p.alarmFile : null;
}
export function alarmClassFileOf(docs: ProjectDocs): string | null {
  const p = docs['project.json']?.value;
  return isObject(p) && typeof p.alarmClassFile === 'string' ? p.alarmClassFile : null;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * project.json thuộc họ định dạng "Tag v1" (0.2.x đến 0.6.x và 1.0.x): có kết nối, bảng giá trị, bảng theo dõi. Tên giữ
 * từ feature 006; các định dạng sau dùng chung các file đó nên mọi chỗ kiểm `isVersion02` cũng đúng với chúng.
 */
export const isVersion02 = (project: unknown): boolean =>
  isObject(project) &&
  typeof project.schemaVersion === 'string' &&
  /^(0\.[2-6]|1\.0)\.\d+$/.test(project.schemaVersion);

/**
 * project.json khai schemaVersion 0.3.x trở lên (màn hình nhiều item, feature 007; 0.4 thêm binding động hóa và sự kiện của
 * feature 008, 0.5 thêm alarm của feature 009). Họ 0.3 gồm cả 0.4 và 0.5: các định dạng sau chỉ thêm khóa, màn hình và Tag
 * giữ nguyên nên mọi chỗ kiểm `isVersion03` cũng đúng với chúng.
 */
export const isVersion03 = (project: unknown): boolean =>
  isObject(project) &&
  typeof project.schemaVersion === 'string' &&
  /^(0\.[3-6]|1\.0)\.\d+$/.test(project.schemaVersion);

/** project.json khai schemaVersion 0.5.x trở lên (alarm, feature 009; 0.6 và 1.0 là tập con siêu của 0.5 nên cũng có alarm). */
export const isVersion05 = (project: unknown): boolean =>
  isObject(project) &&
  typeof project.schemaVersion === 'string' &&
  /^(0\.[56]|1\.0)\.\d+$/.test(project.schemaVersion);

/**
 * project.json khai schemaVersion 0.6.x trở lên (lưu trữ nâng cao và báo cáo, feature 010; 1.0 là tập con siêu của 0.6);
 * cũng thỏa `isVersion03`.
 */
export const isVersion06 = (project: unknown): boolean =>
  isObject(project) &&
  typeof project.schemaVersion === 'string' &&
  /^(0\.6|1\.0)\.\d+$/.test(project.schemaVersion);

/** project.json khai schemaVersion 1.0.x (logic, template, faceplate, feature 011): định dạng hiện hành của Studio. */
export const isVersion10 = (project: unknown): boolean =>
  isObject(project) &&
  typeof project.schemaVersion === 'string' &&
  /^1\.0\.\d+$/.test(project.schemaVersion);

/**
 * Đường dẫn các file sửa được theo đối tượng (data-model §13.1): project.json, file Tag; project 0.2 thêm file kết
 * nối, bảng giá trị, bảng theo dõi theo danh sách trong project.json.
 */
export function editableRels(docs: ProjectDocs): Set<string> {
  const out = new Set<string>(['project.json', tagFileOf(docs)]);
  const p = docs['project.json']?.value;
  if (isVersion02(p)) {
    const conn = connectionFileOf(docs);
    if (conn) out.add(conn);
    for (const n of stringList((p as Record<string, unknown>).valueTables))
      out.add(valueTableFile(n));
    for (const id of stringList((p as Record<string, unknown>).watchTables))
      out.add(watchTableFile(id));
  }
  if (isVersion03(p))
    for (const id of stringList((p as Record<string, unknown>).screens)) out.add(screenFile(id));
  if (isVersion05(p)) {
    const rec = p as Record<string, unknown>;
    if (typeof rec.alarmFile === 'string') out.add(rec.alarmFile);
    if (typeof rec.alarmClassFile === 'string') out.add(rec.alarmClassFile);
  }
  if (isVersion06(p)) {
    const rec = p as Record<string, unknown>;
    if (typeof rec.loggingFile === 'string') out.add(rec.loggingFile);
    if (typeof rec.reportsFile === 'string') out.add(rec.reportsFile);
  }
  if (isVersion10(p)) {
    for (const f of stringList((p as Record<string, unknown>).templates))
      if (TEMPLATE_REL.test(f)) out.add(f);
    const logic = (p as Record<string, unknown>).logic;
    if (typeof logic === 'string') out.add(logic);
  }
  for (const f of svgBindingFiles(docs)) out.add(f);
  return out;
}

/** project.json khai schemaVersion 0.3.x đến 0.6.x hoặc 1.0.x (màn hình nhiều item). */
const isScreenFormat = isVersion03;

/** Đường dẫn file binding của mọi item `svg` (feature 008), theo `bindingFile` trong file màn hình. */
export function svgBindingFiles(docs: ProjectDocs): string[] {
  const p = docs['project.json']?.value;
  if (!isScreenFormat(p)) return [];
  const out: string[] = [];
  for (const id of stringList((p as Record<string, unknown>).screens)) {
    const d = docs[screenFile(id)];
    const items = isObject(d?.value) ? (d.value as Record<string, unknown>).items : undefined;
    if (!Array.isArray(items) || d?.removed) continue;
    for (const it of items)
      if (isObject(it) && it.type === 'svg' && typeof it.bindingFile === 'string')
        if (!out.includes(it.bindingFile)) out.push(it.bindingFile);
  }
  return out;
}

/**
 * Đặt cờ sửa được cho tài liệu theo `editableRels`. `readOnly` (project 0.1 mở chỉ đọc) khóa mọi tài liệu. File Tag
 * của project 0.2 được ghi theo format-02.
 */
export function withEditable(
  docs: Record<string, ProjectDoc> | ProjectDocs,
  opts: { readOnly?: boolean } = {},
): Record<string, ProjectDoc> {
  const rels = editableRels(docs);
  const tagFile = tagFileOf(docs);
  const is02 = isVersion02(docs['project.json']?.value);
  const is03 = isVersion03(docs['project.json']?.value);
  const pj = docs['project.json']?.value;
  const alarmFile = isVersion05(pj) ? (pj as Record<string, unknown>).alarmFile : undefined;
  const classFile = isVersion05(pj) ? (pj as Record<string, unknown>).alarmClassFile : undefined;
  const out: Record<string, ProjectDoc> = {};
  for (const [rel, doc] of Object.entries(docs)) {
    const editable =
      !opts.readOnly && rels.has(rel) && doc.value !== null && doc.pending === undefined;
    const fmt: DocFormat | undefined =
      is02 && rel === tagFile
        ? 'tags02'
        : is03 && rel === 'project.json'
          ? 'project03'
          : is03 && SCREEN_REL.test(rel)
            ? 'screen03'
            : rel === alarmFile
              ? 'alarms05'
              : rel === classFile
                ? 'alarmClasses05'
                : undefined;
    let next = doc.editable === editable ? doc : { ...doc, editable };
    if (fmt !== next.fmt && fmt) {
      // File Tag vừa biết là 0.2: chuỗi chuẩn của nội dung trên đĩa đổi theo cách ghi mới.
      const disk = parseValue(next.diskText);
      next = {
        ...next,
        fmt,
        cleanText: disk === null || next.created ? next.cleanText : renderValue(disk, fmt),
      };
    }
    out[rel] = next;
  }
  return out;
}

/** Dựng EditableProject từ các tài liệu (bỏ tài liệu đã xóa hay hỏng). */
function editableOf(docs: ProjectDocs): EditableProject | null {
  const p = docs['project.json']?.value as Project | undefined;
  if (!isObject(p)) return null;
  const tDoc = docs[tagFileOf(docs)];
  const connFile = connectionFileOf(docs);
  const cDoc = connFile ? docs[connFile] : undefined;
  const state: EditableProject = { project: p, tags: tDoc?.value as TagList };
  if (cDoc && !cDoc.removed && isObject(cDoc.value))
    state.connections = cDoc.value as unknown as ConnectionsConfig;
  else state.connections = null;
  const tables: Record<string, ValueTableDoc> = {};
  for (const n of stringList((p as unknown as Record<string, unknown>).valueTables)) {
    const d = docs[valueTableFile(n)];
    if (d && !d.removed && isObject(d.value)) tables[n] = d.value as unknown as ValueTableDoc;
  }
  const watches: Record<string, WatchTableDoc> = {};
  for (const id of stringList((p as unknown as Record<string, unknown>).watchTables)) {
    const d = docs[watchTableFile(id)];
    if (d && !d.removed && isObject(d.value)) watches[id] = d.value as unknown as WatchTableDoc;
  }
  state.valueTables = tables;
  state.watchTables = watches;
  if (isVersion03(p)) {
    const screens: Record<string, ScreenModel> = {};
    for (const id of stringList((p as unknown as Record<string, unknown>).screens)) {
      const d = docs[screenFile(id)];
      if (d && !d.removed && isObject(d.value)) screens[id] = d.value as unknown as ScreenModel;
    }
    state.screens = screens;
  }
  if (isVersion05(p)) {
    const rec = p as unknown as Record<string, unknown>;
    const a = typeof rec.alarmFile === 'string' ? docs[rec.alarmFile] : undefined;
    const c = typeof rec.alarmClassFile === 'string' ? docs[rec.alarmClassFile] : undefined;
    state.alarms = a && !a.removed && isObject(a.value) ? (a.value as unknown as AlarmsFile) : null;
    state.alarmClasses =
      c && !c.removed && isObject(c.value) ? (c.value as unknown as AlarmClassesFile) : null;
  }
  const sb: Record<string, BindingSet04> = {};
  for (const file of svgBindingFiles(docs)) {
    const d = docs[file];
    if (d && !d.removed && isObject(d.value)) sb[file] = d.value as unknown as BindingSet04;
  }
  state.svgBindings = sb;
  if (isVersion06(p)) {
    const rec = p as unknown as Record<string, unknown>;
    const l = typeof rec.loggingFile === 'string' ? docs[rec.loggingFile] : undefined;
    const r = typeof rec.reportsFile === 'string' ? docs[rec.reportsFile] : undefined;
    state.logging =
      l && !l.removed && isObject(l.value) ? (l.value as unknown as LoggingConfig) : null;
    state.reports =
      r && !r.removed && isObject(r.value) ? (r.value as unknown as ReportsConfig) : null;
  }
  if (isVersion10(p)) {
    const templates: Record<string, TemplateDoc> = {};
    for (const f of stringList((p as unknown as Record<string, unknown>).templates)) {
      const id = TEMPLATE_REL.exec(f)?.[1];
      const d = docs[f];
      if (id && d && !d.removed && isObject(d.value))
        templates[id] = d.value as unknown as TemplateDoc;
    }
    state.templates = templates;
    const lf = (p as unknown as Record<string, unknown>).logic;
    const l = typeof lf === 'string' ? docs[lf] : undefined;
    state.logic = l && !l.removed && isObject(l.value) ? (l.value as unknown as LogicDoc) : null;
  }
  return state;
}

/**
 * Áp sửa đổi lên các tài liệu sửa được; trả tập tài liệu mới. Tài liệu không bị sửa giữ nguyên đối tượng (để so ===);
 * tài liệu không sửa được (chỉ đọc, JSON hỏng) bỏ qua sửa đổi. Bảng mới tạo tài liệu mới; bảng bị xóa hay đổi tên
 * đánh dấu `removed` (file bị xóa khi lưu), riêng bảng chưa từng lưu thì bỏ hẳn.
 */
export function applyDocEdits(
  docs: ProjectDocs,
  edits: readonly ProjectEdit[],
): Record<string, ProjectDoc> {
  const out: Record<string, ProjectDoc> = { ...docs };
  const pDoc = docs['project.json'];
  if (!pDoc?.editable) return out;
  const base = editableOf(docs);
  if (!base) return out;
  const tagFile = tagFileOf(docs);
  const tDoc = docs[tagFile];
  // File Tag không sửa được: bỏ các sửa đổi Tag (nhưng giữ phần còn lại).
  const tagsOk = !!tDoc?.editable;
  const { state, touched } = applyEdits(base, tagsOk ? edits : stripTagEdits(edits));
  if (touched.project) out['project.json'] = withValue(pDoc, state.project);
  if (touched.tags && tagsOk) out[tagFile] = withValue(tDoc, state.tags);
  if (touched.connections && state.connections) {
    const file = connectionFileOf({ ...out }) ?? CONNECTIONS_FILE;
    const cur = out[file];
    out[file] =
      cur && cur.editable
        ? withValue({ ...cur, removed: undefined } as ProjectDoc, state.connections)
        : newEditableDoc(file, state.connections);
    if (out[file].removed === undefined) delete (out[file] as { removed?: true }).removed;
  }
  const syncTable = (rel: string, value: unknown | undefined, fmt?: DocFormat): void => {
    const cur = out[rel];
    if (value !== undefined) {
      if (cur && cur.editable !== undefined && !cur.pending) {
        const { removed: _removed, ...rest } = cur as ProjectDoc & { removed?: true };
        void _removed;
        out[rel] = withValue(rest, value);
      } else out[rel] = newEditableDoc(rel, value, fmt);
    } else if (cur) {
      if (cur.created) delete out[rel];
      else out[rel] = { ...cur, removed: true };
    }
  };
  for (const name of touched.valueTables)
    syncTable(valueTableFile(name), state.valueTables?.[name]);
  for (const id of touched.watchTables) syncTable(watchTableFile(id), state.watchTables?.[id]);
  for (const id of touched.screens) syncTable(screenFile(id), state.screens?.[id], 'screen03');
  if (touched.alarms)
    syncTable(alarmFileOf(out) ?? ALARMS_FILE, state.alarms ?? undefined, 'alarms05');
  if (touched.alarmClasses)
    syncTable(
      alarmClassFileOf(out) ?? ALARM_CLASSES_FILE,
      state.alarmClasses ?? undefined,
      'alarmClasses05',
    );
  for (const f of touched.svgBindings) syncTable(f, state.svgBindings?.[f]);
  const rec06 = state.project as unknown as Record<string, unknown>;
  if (touched.logging && state.logging && typeof rec06.loggingFile === 'string')
    syncTable(rec06.loggingFile, state.logging);
  if (touched.reports && state.reports && typeof rec06.reportsFile === 'string')
    syncTable(rec06.reportsFile, state.reports);
  for (const id of touched.templates) syncTable(templateFile(id), state.templates?.[id]);
  if (touched.logic && state.logic)
    syncTable(typeof rec06.logic === 'string' ? rec06.logic : LOGIC_FILE, state.logic);
  return out;
}

const TAG_EDIT_KINDS = new Set(['tagUpsert', 'tagRemove', 'tagField']);
function stripTagEdits(edits: readonly ProjectEdit[]): ProjectEdit[] {
  return edits.flatMap((e): ProjectEdit[] =>
    e.kind === 'batch'
      ? [{ kind: 'batch', edits: stripTagEdits(e.edits) }]
      : TAG_EDIT_KINDS.has(e.kind)
        ? []
        : [e],
  );
}

/**
 * Tài liệu cần ghi khi lưu, theo thứ tự ghi: file Tag (và file khác, file mới) trước, project.json sau, file bị xóa
 * sau cùng (project.json đã thôi tham chiếu chúng). Mỗi file ghi chuỗi chuẩn kèm `diskHash` để Rust phát hiện file
 * bị sửa ngoài Studio (data-model §6).
 */
export function writeOrder(docs: ProjectDocs): ProjectDoc[] {
  const rank = (d: ProjectDoc) => (d.removed ? 2 : d.rel === 'project.json' ? 1 : 0);
  return Object.values(docs)
    .filter(isDirty)
    .sort((a, b) => rank(a) - rank(b));
}

/** Cách ghi của file chưa có tài liệu (khôi phục snapshot): màn hình 0.3, hai file alarm 0.5. */
function formatOfRel(rel: string, docs: ProjectDocs): DocFormat | undefined {
  if (SCREEN_REL.test(rel)) return 'screen03';
  if (rel === alarmFileOf(docs)) return 'alarms05';
  if (rel === alarmClassFileOf(docs)) return 'alarmClasses05';
  return undefined;
}

/** Snapshot cho lịch sử sửa (data-model §4): chuỗi JSON giá trị các tài liệu sửa được, cờ xóa và nội dung chờ ghi. */
export function snapshotOf(docs: ProjectDocs): string {
  const out: Record<string, unknown> = {};
  for (const rel of Object.keys(docs).sort()) {
    const doc = docs[rel];
    if (doc.editable) out[rel] = doc.value;
    if (doc.removed) out[REMOVED_PREFIX + rel] = true;
    // Nội dung chờ ghi (feature 005): khóa `pending:<rel>` (đường dẫn của project không có dấu `:`).
    if (doc.pending !== undefined) out[PENDING_PREFIX + rel] = doc.pending;
  }
  return JSON.stringify(out);
}

const PENDING_PREFIX = 'pending:';
const REMOVED_PREFIX = 'removed:';

/**
 * Khôi phục snapshot: tài liệu có trong snapshot nhận lại giá trị cũ, tài liệu khác giữ nguyên. Tài liệu sửa được mà
 * snapshot không có (bảng tạo sau snapshot): bỏ nếu chưa từng lưu, không thì đánh dấu xóa. Cờ xóa theo snapshot.
 */
export function restoreSnapshot(docs: ProjectDocs, snapshot: string): Record<string, ProjectDoc> {
  const values = JSON.parse(snapshot) as Record<string, unknown>;
  const out: Record<string, ProjectDoc> = { ...docs };
  const pending = new Map<string, string>();
  const removed = new Set<string>();
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(PENDING_PREFIX))
      pending.set(key.slice(PENDING_PREFIX.length), value as string);
    else if (key.startsWith(REMOVED_PREFIX)) removed.add(key.slice(REMOVED_PREFIX.length));
  }
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(PENDING_PREFIX) || key.startsWith(REMOVED_PREFIX)) continue;
    const cur = out[key];
    if (cur) out[key] = withValue(cur, value);
    else out[key] = newEditableDoc(key, value, formatOfRel(key, out));
  }
  for (const [rel, doc] of Object.entries(out)) {
    if (doc.editable && !(rel in values) && doc.pending === undefined) {
      // Tài liệu sửa được mà snapshot không có: tạo sau snapshot.
      if (doc.created) delete out[rel];
      else out[rel] = { ...doc, removed: true };
      continue;
    }
    const cur = out[rel];
    if (cur && removed.has(rel) !== !!cur.removed) {
      const { removed: _r, ...rest } = cur;
      void _r;
      out[rel] = removed.has(rel) ? { ...rest, removed: true } : rest;
    }
  }
  // Tài liệu đang có nội dung chờ ghi mà snapshot không có: bỏ (file mới thì bỏ cả tài liệu).
  for (const [rel, doc] of Object.entries(out)) {
    if (doc.pending === undefined || pending.has(rel)) continue;
    if (doc.created) delete out[rel];
    else out[rel] = withoutPending(doc);
  }
  for (const [rel, text] of pending) {
    const doc = out[rel];
    if (!doc) out[rel] = newPendingDoc(rel, text);
    else if (doc.pending !== text) out[rel] = withPending(doc, text);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cấu trúc project đọc được từ các file, kể cả khi project còn lỗi: cây project, ánh xạ lỗi,
// "Dùng ở đâu" dùng chung. Chỉ kiểm hình dạng tối thiểu; nội dung sai do bộ kiểm tra báo.

/** Giá trị đã parse của các file JSON theo đường dẫn tương đối; file thiếu hoặc hỏng thì không có. */
export type ProjectFiles = Readonly<Record<string, unknown>>;

export interface ScreenOutline {
  id: string;
  /** `screens/{id}.screen.json` */
  file: string;
  screen: Screen | null;
  bindingFile: string | null;
  bindings: BindingSet | null;
  /** Màn hình 0.3 (nhiều item); `null` ở 0.1/0.2 hoặc khi file thiếu hay sai hình dạng. */
  model: ScreenModel | null;
  /** 0.3: binding của từng item `svg` theo id item (file thiếu hoặc hỏng thì không có khóa). */
  itemBindings: Record<string, BindingSet03>;
}

export interface ValueTableOutline {
  name: string;
  /** `value-tables/<tên>.json` */
  file: string;
  doc: ValueTableDoc | null;
}

export interface WatchTableOutline {
  id: string;
  /** `watch-tables/<id>.json` */
  file: string;
  doc: WatchTableDoc | null;
}

export interface ProjectOutline {
  /** project.json; null khi thiếu hoặc hỏng. */
  project: Project | null;
  /** Họ định dạng theo project.json: `0.2` khi khai 0.2.x hoặc 0.3.x (Tag v1), không thì `0.1`. */
  version: '0.1' | '0.2';
  /** Phiên bản đúng của project.json: 0.1.x, 0.2.x hoặc 0.3.x. */
  schema: '0.1' | '0.2' | '0.3';
  /** `navigation` của project 0.3 (hình dạng chưa kiểm: bộ kiểm tra báo lỗi nếu sai). */
  navigation: Navigation | null;
  tagFile: string;
  /** null: project không có cấu hình lưu trữ (hoặc không đọc được project.json). */
  loggingFile: string | null;
  /** null: project không có file kết nối (hoặc 0.1). */
  connectionFile: string | null;
  tags: TagList | null;
  logging: LoggingConfig | null;
  connections: ConnectionsConfig | null;
  valueTables: ValueTableOutline[];
  watchTables: WatchTableOutline[];
  /** Theo thứ tự `screens` của project.json. */
  screens: ScreenOutline[];
  /** Project 0.5 (alarm): file khai ở project.json và nội dung đọc được (hình dạng tối thiểu). */
  v05: boolean;
  alarmFile: string | null;
  alarmClassFile: string | null;
  alarms: AlarmsFile | null;
  alarmClasses: AlarmClassesFile | null;
  /** Định dạng 0.6 (feature 010): `schema` vẫn là `0.3` (cùng họ), cờ này báo lưu trữ và báo cáo sửa được. */
  format06: boolean;
  /** null: project không có mẫu báo cáo. */
  reportsFile: string | null;
  reports: ReportsConfig | null;
  /** Định dạng 1.0 (feature 011): định dạng hiện hành; project cũ hơn được đề nghị nâng cấp. */
  format10: boolean;
  /** `logic` của project.json 1.0 (null: không có). */
  logicFile: string | null;
  /** Nội dung logic.json đọc được (null: không có hoặc sai hình). */
  logic: LogicDoc | null;
  /** `templates` của project.json 1.0 (đường dẫn, theo thứ tự khai). */
  templateFiles: string[];
  /** Template đọc được (theo `templateFiles`, chỉ đường dẫn `templates/<id>.template.json`); `doc` null khi thiếu hay sai hình. */
  templates: TemplateOutline[];
}

export interface TemplateOutline {
  id: string;
  /** `templates/<id>.template.json` */
  file: string;
  doc: TemplateDoc | null;
}

export function filesOf(docs: ProjectDocs): ProjectFiles {
  const out: Record<string, unknown> = {};
  for (const doc of Object.values(docs))
    if (doc.value !== null && !doc.removed) out[doc.rel] = doc.value;
  return out;
}

export function outlineOf(files: ProjectFiles): ProjectOutline {
  const p = files['project.json'];
  const project = isObject(p) ? (p as unknown as Project) : null;
  const rec = (project ?? {}) as unknown as Record<string, unknown>;
  const version = isVersion02(project) ? '0.2' : '0.1';
  const schema = isVersion03(project) ? '0.3' : version;
  const tagFile = project && typeof project.tagFile === 'string' ? project.tagFile : 'tags.json';
  const loggingFile =
    project && typeof project.loggingFile === 'string' ? project.loggingFile : null;
  const connectionFile =
    version === '0.2' && typeof rec.connectionFile === 'string' ? rec.connectionFile : null;
  const tags = files[tagFile];
  const logging = loggingFile === null ? undefined : files[loggingFile];
  const conn = connectionFile === null ? undefined : files[connectionFile];
  const ids = project && Array.isArray(project.screens) ? project.screens : [];
  const screens = ids
    .filter((id): id is string => typeof id === 'string')
    .map((id): ScreenOutline => {
      const file = `screens/${id}.screen.json`;
      const s = files[file];
      if (schema === '0.3') {
        const model = isObject(s) && Array.isArray(s.items) ? (s as unknown as ScreenModel) : null;
        const itemBindings: Record<string, BindingSet03> = {};
        for (const it of model?.items ?? []) {
          if (!isObject(it) || it.type !== 'svg' || typeof it.bindingFile !== 'string') continue;
          const b = files[it.bindingFile];
          if (isObject(b) && Array.isArray(b.elements))
            itemBindings[String(it.id)] = b as unknown as BindingSet03;
        }
        return { id, file, screen: null, bindingFile: null, bindings: null, model, itemBindings };
      }
      const screen = isObject(s) && Array.isArray(s.elements) ? (s as unknown as Screen) : null;
      const bindingFile =
        screen && typeof screen.bindingFile === 'string' ? screen.bindingFile : null;
      const b = bindingFile === null ? undefined : files[bindingFile];
      const bindings =
        isObject(b) && Array.isArray(b.elements) ? (b as unknown as BindingSet) : null;
      return { id, file, screen, bindingFile, bindings, model: null, itemBindings: {} };
    });
  const valueTables =
    version === '0.2'
      ? stringList(rec.valueTables).map((name): ValueTableOutline => {
          const file = valueTableFile(name);
          const v = files[file];
          return {
            name,
            file,
            doc: isObject(v) && Array.isArray(v.entries) ? (v as unknown as ValueTableDoc) : null,
          };
        })
      : [];
  const watchTables =
    version === '0.2'
      ? stringList(rec.watchTables).map((id): WatchTableOutline => {
          const file = watchTableFile(id);
          const v = files[file];
          return {
            id,
            file,
            doc: isObject(v) && Array.isArray(v.rows) ? (v as unknown as WatchTableDoc) : null,
          };
        })
      : [];
  const nav = rec.navigation;
  const v05 = isVersion05(project);
  const alarmFile = v05 && typeof rec.alarmFile === 'string' ? rec.alarmFile : null;
  const alarmClassFile = v05 && typeof rec.alarmClassFile === 'string' ? rec.alarmClassFile : null;
  const al = alarmFile === null ? undefined : files[alarmFile];
  const cl = alarmClassFile === null ? undefined : files[alarmClassFile];
  const reportsFile = typeof rec.reportsFile === 'string' ? rec.reportsFile : null;
  const reports = reportsFile === null ? undefined : files[reportsFile];
  const format10 = isVersion10(project);
  return {
    format10,
    logicFile: format10 && typeof rec.logic === 'string' ? rec.logic : null,
    logic: (() => {
      const v = format10 && typeof rec.logic === 'string' ? files[rec.logic] : undefined;
      return isObject(v) && typeof v.schemaVersion === 'string' ? (v as unknown as LogicDoc) : null;
    })(),
    templateFiles: format10 ? stringList(rec.templates) : [],
    templates: format10
      ? stringList(rec.templates).flatMap((file): TemplateOutline[] => {
          const id = TEMPLATE_REL.exec(file)?.[1];
          if (!id) return [];
          const v = files[file];
          return [
            {
              id,
              file,
              doc:
                isObject(v) && Array.isArray(v.items) && isObject(v.size)
                  ? (v as unknown as TemplateDoc)
                  : null,
            },
          ];
        })
      : [],
    v05,
    alarmFile,
    alarmClassFile,
    alarms: isObject(al) && Array.isArray(al.alarms) ? (al as unknown as AlarmsFile) : null,
    alarmClasses:
      isObject(cl) && Array.isArray(cl.classes) ? (cl as unknown as AlarmClassesFile) : null,
    format06: isVersion06(project),
    reportsFile,
    reports:
      isObject(reports) && Array.isArray(reports.reports)
        ? (reports as unknown as ReportsConfig)
        : null,
    project,
    version,
    schema,
    navigation: schema === '0.3' && isObject(nav) ? (nav as unknown as Navigation) : null,
    tagFile,
    loggingFile,
    connectionFile,
    tags: isObject(tags) && Array.isArray(tags.tags) ? (tags as unknown as TagList) : null,
    logging:
      isObject(logging) && Array.isArray(logging.groups)
        ? (logging as unknown as LoggingConfig)
        : null,
    connections:
      isObject(conn) && Array.isArray(conn.channels)
        ? (conn as unknown as ConnectionsConfig)
        : null,
    valueTables,
    watchTables,
    screens,
  };
}

/** Hai giá trị JSON bằng nhau (so chuỗi tuần tự hóa). */
export const sameValue = same;
