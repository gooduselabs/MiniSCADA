// Đổi tên Tag trong Studio (feature 006, T189, FR-047, D32): dựng kế hoạch từ project đang mở (danh sách chỗ sẽ đổi để người
// dùng xem, sửa đổi áp một lần) và tách yêu cầu đổi tên ra khỏi sửa đổi ô tên của Bảng Tag (ô tên của Tag đang được dùng mở
// hộp thoại thay vì đổi lặng lẽ). Hàm thuần; luật đổi nằm ở `renameTag` của @mat/project-schema.
import {
  renameTag,
  type BindingSet02,
  type BindingSet04,
  type RenameCode,
  type RenameHit,
  type ScreenModel,
  type RenameProject,
  type TagListV1,
  type WatchTableDoc,
} from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import { serialize, type ProjectEdit, type ProjectOutline } from './project-doc.ts';
import { renameTagInSet } from './svg-binding-doc.ts';
import { eachSvgElement, xrefLocation, xrefText, type XrefEntry } from './xref.ts';
import type { Location } from './issue-map.ts';

export interface RenameItem {
  text: string;
  location: Location | null;
}

export interface RenameChange {
  edits: ProjectEdit[];
  /** Đường dẫn file → nội dung mới (lưu trữ, binding: không sửa theo đối tượng nên thay cả file). */
  replace: Record<string, string>;
}

export type RenamePlan =
  | { ok: true; items: RenameItem[]; change: RenameChange }
  | { ok: false; code: RenameCode; message: string };

type OutlineForRename = Pick<
  ProjectOutline,
  'tags' | 'watchTables' | 'logging' | 'screens' | 'loggingFile'
>;

function projectOf(o: OutlineForRename): RenameProject {
  const watch: Record<string, WatchTableDoc> = {};
  for (const w of o.watchTables) if (w.doc) watch[w.id] = w.doc;
  const bindings: Record<string, BindingSet02> = {};
  const screens: Record<string, ScreenModel> = {};
  for (const s of o.screens) {
    if (s.bindings) bindings[s.id] = s.bindings as unknown as BindingSet02;
    if (s.model) screens[s.id] = s.model;
  }
  return {
    tags: (o.tags ?? { schemaVersion: '', tags: [] }) as unknown as TagListV1,
    watchTables: watch,
    logging: o.logging,
    bindings,
    screens,
  };
}

/** Câu cho một chỗ sẽ đổi (dùng chung câu của "Dùng ở đâu"). */
function itemOf(hit: RenameHit, o: OutlineForRename): RenameItem {
  if (hit.kind === 'tag') return { text: t('rtd.hit.tag'), location: null };
  let entry: XrefEntry;
  if (hit.kind === 'expression') {
    const row = (o.tags?.tags ?? []).findIndex((x) => (x as { id?: string }).id === hit.tag);
    entry = { kind: 'expression', tag: hit.tag, row };
  } else if (hit.kind === 'watch') {
    const w = o.watchTables.find((x) => x.id === hit.table);
    entry = {
      kind: 'watch',
      table: hit.table,
      tableName: typeof w?.doc?.name === 'string' && w.doc.name ? w.doc.name : hit.table,
      row: hit.row,
    };
  } else if (hit.kind === 'logging') {
    const g = o.logging?.groups[hit.group];
    entry = {
      kind: 'logging',
      group: hit.group,
      groupId: g?.id ?? '',
      groupName: g?.name?.trim() ? g.name : (g?.id ?? ''),
    };
  } else if (hit.kind === 'widget') {
    const s = o.screens.find((x) => x.id === hit.screen);
    const item = s?.model?.items.find((x) => x.id === hit.item);
    entry = {
      kind: 'widget',
      screen: hit.screen,
      screenName: s?.model?.name?.trim() ? s.model.name : hit.screen,
      item: hit.item,
      itemName: item?.name?.trim() ? item.name : hit.item,
      slot: hit.slot,
    };
  } else if (hit.kind === 'event') {
    const s = o.screens.find((x) => x.id === hit.screen);
    entry = {
      kind: 'svgElement',
      via: 'event',
      screen: hit.screen,
      screenName: s?.model?.name?.trim() ? s.model.name : hit.screen,
      item: '',
      itemName: '-',
      element: hit.element,
      elementName: hit.element,
      target: 'click',
    };
  } else {
    const s = o.screens.find((x) => x.id === hit.screen);
    const el = (s?.screen?.elements ?? []).find((e) => e.elementUid === hit.element);
    const binding = s?.bindings?.elements
      .find((e) => e.elementUid === hit.element)
      ?.bindings.find((b) => b.id === hit.binding);
    entry = {
      kind: 'binding',
      screen: hit.screen,
      screenName: s?.screen?.name?.trim() ? s.screen.name : hit.screen,
      element: hit.element,
      elementName: el?.name?.trim() ? el.name : hit.element,
      target: binding?.target ?? '',
      bindingId: hit.binding,
    };
  }
  return { text: xrefText(entry), location: xrefLocation(entry) };
}

/** Kế hoạch đổi `from` thành `to`: danh sách chỗ sẽ đổi (không kể định nghĩa Tag) và sửa đổi áp một lần. */
export function planRename(
  o: OutlineForRename & { screens: ProjectOutline['screens'] },
  from: string,
  to: string,
): RenamePlan {
  const r = renameTag(projectOf(o), from, to);
  if (!r.ok) return r;
  const before = (o.tags?.tags ?? []) as unknown as { id: string }[];
  const edits: ProjectEdit[] = [];
  r.project.tags.tags.forEach((tag, index) => {
    if (JSON.stringify(tag) !== JSON.stringify(before[index]))
      edits.push({ kind: 'tagUpsert', index, tag });
  });
  for (const table of Object.values(r.project.watchTables))
    edits.push({ kind: 'watchTableUpsert', table });
  for (const screen of Object.values(r.project.screens))
    edits.push({ kind: 'screenUpsert', screen });
  const replace: Record<string, string> = {};
  if (r.project.logging && o.loggingFile) replace[o.loggingFile] = serialize(r.project.logging);
  for (const [id, set] of Object.entries(r.project.bindings)) {
    const file = o.screens.find((s) => s.id === id)?.bindingFile;
    if (file) replace[file] = serialize(set);
  }
  const items = r.hits.filter((h) => h.kind !== 'tag').map((h) => itemOf(h, o));
  // Item `svg` (feature 008): binding và sự kiện ghi của từng phần tử, cùng một bước hoàn tác (edits gộp trong change).
  for (const s of o.screens) {
    for (const item of s.model?.items ?? []) {
      if (item.type !== 'svg') continue;
      const set = s.itemBindings[item.id] as unknown as BindingSet04 | undefined;
      if (!set) continue;
      const res = renameTagInSet(set, from, to);
      if (res.count === 0) continue;
      edits.push({ kind: 'svgBindings', file: item.bindingFile, set: res.set });
    }
  }
  for (const { entry, names } of eachSvgElement({ screens: o.screens, logging: null })) {
    for (const b of entry.bindings ?? [])
      if (b.source.tagId === from) {
        const e: XrefEntry = {
          kind: 'svgElement',
          via: 'binding',
          ...names,
          target: b.target,
          bindingId: b.id,
        };
        items.push({ text: xrefText(e), location: xrefLocation(e) });
      }
    const c = entry.events?.click;
    if (c !== undefined && 'tag' in c && c.tag === from) {
      const e: XrefEntry = { kind: 'svgElement', via: 'event', ...names, target: c.action };
      items.push({ text: xrefText(e), location: xrefLocation(e) });
    }
  }
  return { ok: true, items, change: { edits, replace } };
}

/** Thông báo sau khi đổi. */
export const renameDone = (from: string, to: string, n: number): string =>
  t('rtd.done', { from, to, n });

export interface RenameRequest {
  from: string;
  to: string;
}

/**
 * Tách yêu cầu đổi tên ra khỏi sửa đổi của lưới: ô tên của Tag đang được dùng (biểu thức, bảng theo dõi, lưu trữ, binding)
 * không đổi ngay mà trả lại thành yêu cầu để mở hộp thoại. Các sửa đổi khác trong cùng lần gõ vẫn áp. Tag chưa ai dùng
 * đổi tên thẳng như trước.
 */
export function splitRenames(
  tags: readonly { id?: unknown }[],
  edits: readonly ProjectEdit[],
  referenced: (id: string) => boolean,
): { edits: ProjectEdit[]; requests: RenameRequest[] } {
  const requests: RenameRequest[] = [];
  const out: ProjectEdit[] = [];
  const idAt = (index: number | undefined): string | null => {
    const id = index === undefined ? undefined : tags[index]?.id;
    return typeof id === 'string' ? id : null;
  };
  for (const e of edits) {
    if (e.kind === 'batch') {
      const inner = splitRenames(tags, e.edits, referenced);
      requests.push(...inner.requests);
      out.push({ kind: 'batch', edits: inner.edits });
    } else if (e.kind === 'tagField' && e.field === 'id') {
      const from = idAt(e.index);
      const to = typeof e.value === 'string' ? e.value : '';
      if (from !== null && to !== '' && to !== from && referenced(from))
        requests.push({ from, to });
      else out.push(e);
    } else if (e.kind === 'tagUpsert' && e.index !== undefined) {
      const from = idAt(e.index);
      const to = (e.tag as { id?: unknown }).id;
      if (from !== null && typeof to === 'string' && to !== '' && to !== from && referenced(from)) {
        requests.push({ from, to });
        out.push({ ...e, tag: { ...e.tag, id: from } as typeof e.tag });
      } else out.push(e);
    } else out.push(e);
  }
  return { edits: out, requests };
}
