// Đổi tên Tag (feature 006, T189, FR-047, D32): đổi ở định nghĩa Tag, biểu thức của Tag tính toán (theo token của
// @mat/expression, giữ nguyên mọi ký tự khác), dòng của bảng theo dõi, nhóm lưu trữ và binding. Hàm thuần: không sửa
// đầu vào; trả danh sách chỗ sẽ đổi và phần đã đổi để Studio áp thành MỘT bước hoàn tác.
import { tokens } from '@mat/expression';
import { defaultColumnName } from './logging.ts';
import type { LoggingConfig } from './types.ts';
import type { BindingSet02, TagListV1, WatchTableDoc } from './types-02.ts';

export interface RenameProject {
  tags: TagListV1;
  watchTables?: Readonly<Record<string, WatchTableDoc>>;
  logging?: LoggingConfig | null;
  /** Theo id màn hình. */
  bindings?: Readonly<Record<string, BindingSet02>>;
}

export type RenameHit =
  | { kind: 'tag' }
  | { kind: 'expression'; tag: string }
  | { kind: 'watch'; table: string; row: number }
  | { kind: 'logging'; group: number; index: number }
  | { kind: 'binding'; screen: string; element: string; binding: string };

export type RenameCode =
  'E_RENAME_SYNTAX' | 'E_RENAME_EXISTS' | 'E_RENAME_MISSING' | 'E_RENAME_SAME';

export type RenameResult =
  | {
      ok: true;
      hits: RenameHit[];
      /** Chỉ phần đã đổi: `tags` luôn có; bảng theo dõi và binding chỉ khi có chỗ đổi; `logging` null nếu không đổi. */
      project: {
        tags: TagListV1;
        watchTables: Record<string, WatchTableDoc>;
        logging: LoggingConfig | null;
        bindings: Record<string, BindingSet02>;
      };
    }
  | { ok: false; code: RenameCode; message: string };

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
export const TAG_ID_MAX = 64;

/** Tên Tag hợp lệ làm tên mới (cùng luật schema, không trùng từ khóa `true`, `false` của biểu thức). */
export const isValidTagId = (id: string): boolean =>
  id.length <= TAG_ID_MAX && ID_RE.test(id) && id !== 'true' && id !== 'false';

/** Thay các token Tag đúng bằng `from` trong biểu thức; trả null nếu không có chỗ nào. */
export function renameInExpression(src: string, from: string, to: string): string | null {
  return replaceTokens(src, (tk) => tk.kind === 'tag' && tk.text === from, to);
}

/** Như `renameInExpression` nhưng cho tên bảng giá trị trong `text(x, Bảng)`; null nếu không có chỗ nào. */
export function renameTableInExpression(src: string, from: string, to: string): string | null {
  return replaceTokens(src, (tk) => tk.kind === 'table' && tk.text === from, to);
}

function replaceTokens(
  src: string,
  match: (tk: ReturnType<typeof tokens>[number]) => boolean,
  to: string,
): string | null {
  const cps = Array.from(src);
  const spans = tokens(src)
    .filter(match)
    .map((tk) => tk.span);
  if (!spans.length) return null;
  let out = '';
  let at = 0;
  for (const [s, e] of spans) {
    out += cps.slice(at, s).join('') + to;
    at = e;
  }
  return out + cps.slice(at).join('');
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function renameTag(project: RenameProject, from: string, to: string): RenameResult {
  const fail = (code: RenameCode, message: string): RenameResult => ({ ok: false, code, message });
  if (from === to) return fail('E_RENAME_SAME', 'new name equals old name');
  if (!isValidTagId(to)) return fail('E_RENAME_SYNTAX', `'${to}' is not a valid tag name`);
  const ids = new Set(project.tags.tags.map((x) => x.id));
  if (!ids.has(from)) return fail('E_RENAME_MISSING', `tag '${from}' does not exist`);
  if (ids.has(to)) return fail('E_RENAME_EXISTS', `tag '${to}' already exists`);

  const hits: RenameHit[] = [];
  const tags = clone(project.tags);
  for (const tg of tags.tags) {
    if (tg.id === from) {
      tg.id = to;
      hits.push({ kind: 'tag' });
    }
  }
  const exprHits: RenameHit[] = [];
  for (const tg of tags.tags) {
    if (typeof tg.expression !== 'string') continue;
    const next = renameInExpression(tg.expression, from, to);
    if (next !== null) {
      tg.expression = next;
      exprHits.push({ kind: 'expression', tag: tg.id });
    }
  }
  hits.push(...exprHits);

  const watchTables: Record<string, WatchTableDoc> = {};
  for (const [id, doc] of Object.entries(project.watchTables ?? {})) {
    let copy: WatchTableDoc | null = null;
    doc.rows.forEach((row, i) => {
      if (row.tag !== from) return;
      copy ??= clone(doc);
      copy.rows[i]!.tag = to;
      hits.push({ kind: 'watch', table: id, row: i });
    });
    if (copy) watchTables[id] = copy;
  }

  let logging: LoggingConfig | null = null;
  if (project.logging) {
    const log = clone(project.logging);
    let changed = false;
    log.groups.forEach((g, gi) =>
      g.tags.forEach((lt, i) => {
        if (lt.tagId !== from) return;
        // Cột mặc định theo tên Tag: giữ cột cũ để cấu trúc bảng trong cơ sở dữ liệu không đổi.
        if (lt.column === undefined && defaultColumnName(from) !== defaultColumnName(to))
          lt.column = defaultColumnName(from);
        lt.tagId = to;
        changed = true;
        hits.push({ kind: 'logging', group: gi, index: i });
      }),
    );
    if (changed) logging = log;
  }

  const bindings: Record<string, BindingSet02> = {};
  for (const [screen, set] of Object.entries(project.bindings ?? {})) {
    let copy: BindingSet02 | null = null;
    set.elements.forEach((el, ei) =>
      el.bindings.forEach((b, bi) => {
        if (b.source?.tagId !== from) return;
        copy ??= clone(set);
        copy.elements[ei]!.bindings[bi]!.source.tagId = to;
        hits.push({ kind: 'binding', screen, element: el.elementUid, binding: b.id });
      }),
    );
    if (copy) bindings[screen] = copy;
  }

  return { ok: true, hits, project: { tags, watchTables, logging, bindings } };
}
