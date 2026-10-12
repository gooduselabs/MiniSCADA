// Tài liệu project của Studio: sửa project.json và file Tag trên bản sao, giữ thứ tự khóa và trường
// không chạm (FR-022, khắc phục FR-033 của audit Sprint 1), ghi theo định dạng chuẩn JSON 2 dấu cách.
// Phần đầu là các sửa đổi (applyProjectEdits); phần "Feature 004" là tài liệu đang mở, thứ tự ghi,
// snapshot cho lịch sử và cấu trúc project đọc được. Logic form của Sprint 1 đã bỏ cùng giao diện cũ.
import {
  stripBom,
  type BindingSet,
  type LoggingConfig,
  type Project,
  type Screen,
  type TagDefinition,
  type TagList,
} from '@mat/project-schema';

export type ProjectField = 'projectName' | 'projectVersion' | 'entryScreen' | 'maxClients';

/** Khóa của Tag theo thứ tự file chuẩn (data-model §3.1); cũng là các cột của Bảng Tag. */
export const TAG_KEY_ORDER = ['id', 'type', 'description', 'unit', 'min', 'max', 'source'] as const;
export type TagField = (typeof TAG_KEY_ORDER)[number];

export type ProjectEdit =
  | { kind: 'project'; field: ProjectField; value: string | number }
  /**
   * Đặt nhiều khóa của project.json một lần (So sánh › Đọc lên phần chọn, feature 005); `undefined` thì bỏ khóa.
   * Khóa đã có giữ chỗ, khóa mới thêm ở cuối.
   */
  | { kind: 'projectPatch'; fields: Readonly<Record<string, unknown>> }
  | { kind: 'tagUpsert'; index?: number; tag: TagDefinition }
  | { kind: 'tagRemove'; index: number }
  /** Gán một trường của Tag (Bảng Tag); `value` undefined thì bỏ khóa. */
  | { kind: 'tagField'; index: number; field: TagField; value?: unknown };

export interface EditableProject {
  project: Project;
  tags: TagList;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Áp các sửa đổi lên bản sao (không đụng bản gốc); giữ thứ tự khóa và trường không sửa. */
export function applyProjectEdits(base: EditableProject, edits: ProjectEdit[]): EditableProject {
  const project = clone(base.project);
  const tags = clone(base.tags);
  const tagList = isObject(tags) && Array.isArray(tags.tags) ? tags.tags : null;
  for (const e of edits) {
    if (e.kind === 'project') {
      if (isObject(project)) (project as unknown as Record<string, unknown>)[e.field] = e.value;
    } else if (e.kind === 'projectPatch') {
      if (isObject(project)) patchObject(project as unknown as Record<string, unknown>, e.fields);
    } else if (!tagList) {
      continue; // file Tag hỏng: không sửa được
    } else if (e.kind === 'tagUpsert') {
      if (e.index === undefined) tagList.push(clone(e.tag));
      else tagList[e.index] = clone(e.tag);
    } else if (e.kind === 'tagField') {
      const cur: unknown = tagList[e.index];
      if (isObject(cur))
        tagList[e.index] = setTagField(cur as unknown as TagDefinition, e.field, e.value);
    } else {
      tagList.splice(e.index, 1);
    }
  }
  return { project, tags };
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
  const i = (TAG_KEY_ORDER as readonly string[]).indexOf(k);
  return i < 0 ? TAG_KEY_ORDER.length : i;
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
export function setTagField(tag: TagDefinition, field: TagField, value: unknown): TagDefinition {
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
  return Object.fromEntries(entries) as unknown as TagDefinition;
}

/** Định dạng chuẩn của file project do Studio ghi (cũng là định dạng của project mẫu). */
export const serialize = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

// ---------------------------------------------------------------------------------------------
// Feature 004: tài liệu đang mở (data-model §3.1)

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
  /** Sửa được: project.json và file Tag (data-model §3.1), và chỉ khi JSON đọc được. */
  readonly editable: boolean;
  /**
   * Nội dung chờ ghi (feature 005, FR-030): cả file lấy từ thiết bị (So sánh › Đọc lên phần chọn) cho file không
   * sửa được theo đối tượng (lưu trữ, màn hình, binding, SVG). Có thì Lưu ghi đúng chuỗi này; khác `diskText` thì
   * là chưa lưu.
   */
  readonly pending?: string;
  /** File chưa có trên đĩa (chỉ có trên thiết bị): ghi với hash `null`; hoàn tác thì bỏ cả tài liệu. */
  readonly created?: true;
}

/** Tập tài liệu theo đường dẫn tương đối. */
export type ProjectDocs = Readonly<Record<string, ProjectDoc>>;

export function loadDoc(
  rel: string,
  text: string,
  hash: string | null,
  editable: boolean,
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
    cleanText: ok ? serialize(value) : '',
    value: ok ? value : null,
    editable: editable && ok,
  };
}

/**
 * Chưa lưu: chuỗi sẽ ghi khác nội dung trên đĩa. Tài liệu sửa được so `serialize(value)` với `cleanText`
 * (sửa về như cũ thì hết); nội dung chờ ghi so với `diskText`.
 */
export const isDirty = (doc: ProjectDoc): boolean =>
  doc.pending !== undefined
    ? doc.pending !== doc.diskText
    : doc.editable && doc.value !== null && serialize(doc.value) !== doc.cleanText;

/** Chuỗi sẽ ghi xuống đĩa khi Lưu (và bộ kiểm tra thấy). */
export const writtenText = (doc: ProjectDoc): string =>
  doc.pending !== undefined ? doc.pending : serialize(doc.value);

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

/**
 * Áp sửa đổi lên project.json và file Tag; trả tập tài liệu mới. Tài liệu không bị sửa giữ nguyên đối
 * tượng (để so ===); tài liệu không sửa được (JSON hỏng) bỏ qua sửa đổi.
 */
export function applyDocEdits(
  docs: ProjectDocs,
  edits: readonly ProjectEdit[],
): Record<string, ProjectDoc> {
  const out: Record<string, ProjectDoc> = { ...docs };
  const pDoc = docs['project.json'];
  const tagFile = tagFileOf(docs);
  const tDoc = docs[tagFile];
  const next = applyProjectEdits(
    { project: pDoc?.value as Project, tags: tDoc?.value as TagList },
    [...edits],
  );
  const projectKind = (e: ProjectEdit) => e.kind === 'project' || e.kind === 'projectPatch';
  if (pDoc?.editable && edits.some(projectKind))
    out['project.json'] = withValue(pDoc, next.project);
  if (tDoc?.editable && edits.some((e) => !projectKind(e)))
    out[tagFile] = withValue(tDoc, next.tags);
  return out;
}

/**
 * Tài liệu cần ghi khi lưu, theo thứ tự ghi: file Tag (và file khác) trước, project.json sau cùng.
 * Mỗi file ghi `serialize(value)` kèm `diskHash` để Rust phát hiện file bị sửa bên ngoài (data-model §6).
 */
export function writeOrder(docs: ProjectDocs): ProjectDoc[] {
  return Object.values(docs)
    .filter(isDirty)
    .sort((a, b) => Number(a.rel === 'project.json') - Number(b.rel === 'project.json'));
}

/** Snapshot cho lịch sử sửa (data-model §4): chuỗi JSON giá trị các tài liệu sửa được. */
export function snapshotOf(docs: ProjectDocs): string {
  const out: Record<string, unknown> = {};
  for (const rel of Object.keys(docs).sort()) {
    const doc = docs[rel];
    if (doc.editable) out[rel] = doc.value;
    // Nội dung chờ ghi (feature 005): khóa `pending:<rel>` (đường dẫn của project không có dấu `:`).
    if (doc.pending !== undefined) out[PENDING_PREFIX + rel] = doc.pending;
  }
  return JSON.stringify(out);
}

const PENDING_PREFIX = 'pending:';

/** Khôi phục snapshot: tài liệu có trong snapshot nhận lại giá trị cũ, tài liệu khác giữ nguyên. */
export function restoreSnapshot(docs: ProjectDocs, snapshot: string): Record<string, ProjectDoc> {
  const values = JSON.parse(snapshot) as Record<string, unknown>;
  const out: Record<string, ProjectDoc> = { ...docs };
  const pending = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(PENDING_PREFIX))
      pending.set(key.slice(PENDING_PREFIX.length), value as string);
    else if (out[key]) out[key] = withValue(out[key], value);
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
}

export interface ProjectOutline {
  /** project.json; null khi thiếu hoặc hỏng. */
  project: Project | null;
  tagFile: string;
  /** null: project không có cấu hình lưu trữ (hoặc không đọc được project.json). */
  loggingFile: string | null;
  tags: TagList | null;
  logging: LoggingConfig | null;
  /** Theo thứ tự `screens` của project.json. */
  screens: ScreenOutline[];
}

export function filesOf(docs: ProjectDocs): ProjectFiles {
  const out: Record<string, unknown> = {};
  for (const doc of Object.values(docs)) if (doc.value !== null) out[doc.rel] = doc.value;
  return out;
}

export function outlineOf(files: ProjectFiles): ProjectOutline {
  const p = files['project.json'];
  const project = isObject(p) ? (p as unknown as Project) : null;
  const tagFile = project && typeof project.tagFile === 'string' ? project.tagFile : 'tags.json';
  const loggingFile =
    project && typeof project.loggingFile === 'string' ? project.loggingFile : null;
  const tags = files[tagFile];
  const logging = loggingFile === null ? undefined : files[loggingFile];
  const ids = project && Array.isArray(project.screens) ? project.screens : [];
  const screens = ids
    .filter((id): id is string => typeof id === 'string')
    .map((id): ScreenOutline => {
      const file = `screens/${id}.screen.json`;
      const s = files[file];
      const screen = isObject(s) && Array.isArray(s.elements) ? (s as unknown as Screen) : null;
      const bindingFile =
        screen && typeof screen.bindingFile === 'string' ? screen.bindingFile : null;
      const b = bindingFile === null ? undefined : files[bindingFile];
      const bindings =
        isObject(b) && Array.isArray(b.elements) ? (b as unknown as BindingSet) : null;
      return { id, file, screen, bindingFile, bindings };
    });
  return {
    project,
    tagFile,
    loggingFile,
    tags: isObject(tags) && Array.isArray(tags.tags) ? (tags as unknown as TagList) : null,
    logging:
      isObject(logging) && Array.isArray(logging.groups)
        ? (logging as unknown as LoggingConfig)
        : null,
    screens,
  };
}
