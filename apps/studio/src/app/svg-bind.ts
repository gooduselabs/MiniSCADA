// Thao tác gắn Tag cho phần tử SVG của item đang vào (feature 008, T072, T074, T081; contract studio-svg-editor §5, §6, §8).
// Lớp mỏng giữa giao diện và hàm thuần của `model/svg-binding-doc.ts`: đọc bộ binding của item từ project đang mở, gọi hàm
// thuần, ghi MỘT bước hoàn tác (`svgBindings`) hoặc báo lý do từ chối bằng thông báo. Không DOM ngoài việc hỏi loại phần tử.
import type { Binding04, BindingSet04, ElementAction, SvgItem } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import {
  newBinding,
  rowById,
  rowOfBinding,
  spinPresetTransform,
  spinSpeedOf,
  SPIN_PRESETS,
  type ElementKind,
  type SpinPreset,
  type RowId,
  type TransformKind04,
} from '../model/animation-catalog.ts';
import {
  addBinding,
  applyToMany,
  clearEvent,
  copyBindings,
  elementOf,
  emptyBindingSet,
  removeBinding,
  setEvent,
  updateBinding,
  type BindCtx,
  type BindRejection,
  type EventCtx,
  type EventRejection,
} from '../model/svg-binding-doc.ts';
import { elementKindOf, findByUid, nameOfElement } from '../model/svg-dom.ts';
import { suggest, type Suggestion } from '../model/svg-suggest.ts';
import type { ProjectEdit } from '../model/project-doc.ts';
import type { StudioApp } from './app.ts';

/** Item `svg` đang làm việc: màn hình, item và file binding của nó. */
export interface ItemRef {
  screen: string;
  item: string;
  file: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function itemRef(app: StudioApp, screen: string, itemId: string): ItemRef | null {
  const it = app.screenModel(screen)?.items.find((x) => x.id === itemId);
  return it !== undefined && it.type === 'svg'
    ? { screen, item: itemId, file: it.bindingFile }
    : null;
}

/** Bộ binding hiện tại của item (rỗng khi file chưa có hoặc hỏng). */
export function bindingSetOf(app: StudioApp, ref: ItemRef): BindingSet04 {
  const v = app.store.state.docs[ref.file]?.value;
  return isObject(v) && Array.isArray(v.elements)
    ? (v as unknown as BindingSet04)
    : emptyBindingSet(ref.screen, ref.item);
}

/** Tag mà item dùng (binding và sự kiện ghi): đầu vào của thanh Thử giá trị. */
export function itemTagIds(set: BindingSet04): string[] {
  const out = new Set<string>();
  for (const e of set.elements) {
    for (const b of e.bindings ?? []) out.add(b.source.tagId);
    const c = e.events?.click;
    if (c !== undefined && 'tag' in c && typeof c.tag === 'string') out.add(c.tag);
  }
  return [...out];
}

const nameMaps = new WeakMap<object, Map<string, string>>();

/** Tên phần tử để hiện: tên ghi ở `elements` của item, không có thì `data-mat-name` của DOM; rỗng khi chưa đặt tên. */
export function elementNameOf(item: SvgItem, uid: string, el: Element | null): string {
  let m = nameMaps.get(item.elements);
  if (m === undefined) {
    m = new Map();
    for (const e of item.elements)
      if (e.name !== undefined && e.name !== '') m.set(e.elementUid, e.name);
    nameMaps.set(item.elements, m);
  }
  return m.get(uid) ?? (el !== null ? nameOfElement(el) : '');
}

/** Loại phần tử của `uid` theo DOM đã dựng; không thấy thì coi là hình (mục hợp nhiều nhất). */
export function kindOfUid(app: StudioApp, ref: ItemRef, uid: string): ElementKind {
  const root = app.screens.svgRoot(ref.screen, ref.item);
  const el = root === null ? null : findByUid(root, uid);
  return el === null ? 'shape' : elementKindOf(el);
}

export function bindCtx(app: StudioApp, ref: ItemRef, uid: string, tagId: string): BindCtx {
  return { elementKind: kindOfUid(app, ref, uid), tag: app.screens.tagInfos().get(tagId) };
}

export const rejectText = (r: BindRejection): string => t(`svg.reject.${r}` as MessageKey);
export const eventRejectText = (r: EventRejection): string =>
  t(`svg.eventReject.${r}` as MessageKey);

/** Ghi bộ binding mới (một bước hoàn tác). Project chỉ đọc thì báo và không ghi. */
export function commitSet(
  app: StudioApp,
  ref: ItemRef,
  set: BindingSet04,
  mergeKey?: string,
): boolean {
  if (app.store.state.readOnly) {
    app.toast(t('svg.readOnly'));
    return false;
  }
  const edits: ProjectEdit[] = [{ kind: 'svgBindings', file: ref.file, set }];
  const declare = declareElements(app, ref, set);
  if (declare !== null) edits.push(declare);
  app.store.edit(edits, mergeKey);
  return true;
}

/**
 * Phần tử có binding hoặc sự kiện phải được khai báo trong `elements` của item (bộ kiểm tra: `E_REF_UID`; trang và canvas chỉ
 * áp binding cho phần tử khai báo). Nhập SVG chỉ khai báo phần tử có tên, nên gắn Tag cho phần tử chưa có tên thêm khai báo
 * `{ elementUid, name? }` vào item trong CÙNG bước hoàn tác. `null` khi không thiếu khai báo nào.
 */
function declareElements(app: StudioApp, ref: ItemRef, set: BindingSet04): ProjectEdit | null {
  const screen = app.screenModel(ref.screen);
  const item = screen?.items.find((i) => i.id === ref.item);
  if (screen === null || screen === undefined || item === undefined || item.type !== 'svg')
    return null;
  const have = new Set(item.elements.map((e) => e.elementUid));
  const missing = set.elements.map((e) => e.elementUid).filter((u) => !have.has(u));
  if (missing.length === 0) return null;
  const root = app.screens.svgRoot(ref.screen, ref.item);
  const add = missing.map((uid) => {
    const el = root === null ? null : findByUid(root, uid);
    const name = el === null ? '' : nameOfElement(el);
    return name !== '' ? { elementUid: uid, name } : { elementUid: uid };
  });
  const next: SvgItem = { ...item, elements: [...item.elements, ...add] };
  return {
    kind: 'screenUpsert',
    screen: { ...screen, items: screen.items.map((i) => (i.id === ref.item ? next : i)) },
  };
}

export interface ApplyOutcome {
  ok: boolean;
  applied: number;
  skipped: number;
  rejected?: BindRejection;
}

/**
 * Gắn Tag vào mục `rowId` cho `uids` (một hoặc nhiều phần tử, một bước hoàn tác). Phần tử đã có binding cùng nhóm đích thì
 * thay bằng binding mới theo Tag này; phần tử không hợp loại hoặc kiểu Tag bị bỏ qua. Không phần tử nào nhận: báo lý do,
 * không đổi gì.
 */
export function bindRow(
  app: StudioApp,
  ref: ItemRef,
  uids: readonly string[],
  rowId: RowId,
  tagId: string,
  transformKind?: TransformKind04,
): ApplyOutcome {
  const info = app.screens.tagInfos().get(tagId);
  const row = rowById(rowId);
  if (info === undefined || row === undefined) {
    app.toast(rejectText(info === undefined ? 'unknown-tag' : 'unknown-row'));
    return { ok: false, applied: 0, skipped: uids.length, rejected: 'unknown-tag' };
  }
  let set = bindingSetOf(app, ref);
  let applied = 0;
  let skipped = 0;
  let first: BindRejection | undefined;
  for (const uid of uids) {
    const ctx = bindCtx(app, ref, uid, tagId);
    const tpl = newBinding(rowId, ctx.elementKind, info, transformKind);
    if (tpl === null) {
      skipped++;
      first ??= 'transform';
      continue;
    }
    const existing = elementOf(set, uid)?.bindings?.find(
      (b) => rowOfBinding(b)?.group === row.group,
    );
    const base = existing !== undefined ? removeBinding(set, uid, existing.id).set : set;
    const r = addBinding(base, uid, tpl, ctx);
    if (r.rejected !== undefined) {
      skipped++;
      first ??= r.rejected;
      continue;
    }
    set = r.set;
    applied++;
  }
  if (applied === 0) {
    if (first !== undefined) app.toast(rejectText(first));
    return { ok: false, applied, skipped, ...(first !== undefined ? { rejected: first } : {}) };
  }
  commitSet(app, ref, set);
  if (skipped > 0) app.toast(t('svg.bind.partial', { n: applied, m: skipped }));
  return { ok: true, applied, skipped };
}

/** Đổi Tag của một binding có sẵn (giữ phép biến đổi và tham số nếu còn hợp). Trả lý do từ chối. */
export function retag(
  app: StudioApp,
  ref: ItemRef,
  uid: string,
  bindingId: string,
  tagId: string,
): BindRejection | null {
  const set = bindingSetOf(app, ref);
  const old = elementOf(set, uid)?.bindings?.find((x) => x.id === bindingId);
  const patch: Partial<Binding04> = { source: { type: 'tag', tagId } };
  // Quay khi chạy theo tốc độ preset: đổi Tag BOOL ↔ số thì dựng lại phép rời rạc theo kiểu Tag mới (giữ tốc độ). Giữ
  // nguyên phép của BOOL ({true→rpm}, mặc định 0) cho Tag số làm phần tử không bao giờ quay.
  if (old?.animation === 'spin') {
    const infos = app.screens.tagInfos();
    const speed = spinSpeedOf(old, infos.get(old.source.tagId));
    if (speed in SPIN_PRESETS)
      patch.transform = spinPresetTransform(speed as SpinPreset, infos.get(tagId));
  }
  const r = updateBinding(set, uid, bindingId, patch, bindCtx(app, ref, uid, tagId));
  if (r.rejected !== undefined) return r.rejected;
  commitSet(app, ref, r.set);
  return null;
}

/** Sửa binding (phép biến đổi, tham số); `mergeKey` gộp việc gõ liên tục thành một bước. Trả lý do từ chối. */
export function patchBinding(
  app: StudioApp,
  ref: ItemRef,
  uid: string,
  bindingId: string,
  patch: Partial<Binding04>,
  mergeKey?: string,
): BindRejection | null {
  const set = bindingSetOf(app, ref);
  const b = elementOf(set, uid)?.bindings?.find((x) => x.id === bindingId);
  const r = updateBinding(
    set,
    uid,
    bindingId,
    patch,
    bindCtx(app, ref, uid, b?.source.tagId ?? ''),
  );
  if (r.rejected !== undefined) return r.rejected;
  commitSet(app, ref, r.set, mergeKey);
  return null;
}

/** Gỡ binding của mục `rowId` (cùng nhóm đích) ở mọi phần tử `uids`: một bước hoàn tác. */
export function removeRow(
  app: StudioApp,
  ref: ItemRef,
  uids: readonly string[],
  rowId: RowId,
): void {
  const group = rowById(rowId)?.group;
  let set = bindingSetOf(app, ref);
  for (const uid of uids)
    for (const b of elementOf(set, uid)?.bindings ?? [])
      if (rowOfBinding(b)?.group === group) set = removeBinding(set, uid, b.id).set;
  commitSet(app, ref, set);
}

// ---- Gợi ý, sao chép, dán (T074) ----

/** Gợi ý cho phần tử `uid` với Tag `tagId`. */
export function suggestionsFor(
  app: StudioApp,
  ref: ItemRef,
  uid: string,
  name: string,
  tagId: string,
): Suggestion[] {
  const tag = app.screens.tagInfos().get(tagId);
  if (tag === undefined) return [];
  return suggest(kindOfUid(app, ref, uid), name, tag);
}

/** Áp một gợi ý cho `uids` (không bao giờ tự áp dụng: chỉ gọi khi người dùng chấp nhận): một bước hoàn tác. */
export function acceptSuggestion(
  app: StudioApp,
  ref: ItemRef,
  uids: readonly string[],
  s: Suggestion,
): boolean {
  const group = rowById(s.rowId)?.group;
  let set = bindingSetOf(app, ref);
  let count = 0;
  for (const uid of uids) {
    const existing = elementOf(set, uid)?.bindings?.find((b) => rowOfBinding(b)?.group === group);
    const base = existing !== undefined ? removeBinding(set, uid, existing.id).set : set;
    const r = addBinding(base, uid, s.binding, bindCtx(app, ref, uid, s.tagId));
    if (r.rejected === undefined) {
      set = r.set;
      count++;
    }
  }
  return count > 0 && commitSet(app, ref, set);
}

export function copyElementBindings(app: StudioApp, ref: ItemRef, uid: string): number {
  const list = copyBindings(bindingSetOf(app, ref), uid);
  app.screens.bindClip = list.length > 0 ? list : null;
  app.toast(list.length > 0 ? t('svg.copy.done', { n: list.length }) : t('svg.copy.none'));
  return list.length;
}

export function pasteBindings(app: StudioApp, ref: ItemRef, uids: readonly string[]): boolean {
  const clip = app.screens.bindClip;
  if (clip === null || clip.length === 0) {
    app.toast(t('svg.paste.none'));
    return false;
  }
  const res = applyToMany(bindingSetOf(app, ref), uids, clip, (uid, b) =>
    bindCtx(app, ref, uid, b.source.tagId),
  );
  if (res.applied.length === 0) {
    app.toast(t('svg.paste.nothing', { m: res.skipped.length }));
    return false;
  }
  commitSet(app, ref, res.set);
  app.toast(t('svg.paste.done', { n: res.applied.length, m: res.skipped.length }));
  return true;
}

// ---- Sự kiện (T081) ----

export function eventCtx(app: StudioApp, tagId?: string): EventCtx {
  const screens = app.store.state.outline.screens.flatMap((s) =>
    s.model === null || s.model === undefined
      ? []
      : [{ id: s.id, kind: (s.model.kind === 'popup' ? 'popup' : 'screen') as 'screen' | 'popup' }],
  );
  return { screens, tag: tagId === undefined ? undefined : app.screens.tagInfos().get(tagId) };
}

/** Đặt sự kiện nhấp; trả lý do từ chối (hiện ở ô) hoặc null khi đã ghi. */
export function applyEvent(
  app: StudioApp,
  ref: ItemRef,
  uid: string,
  action: ElementAction,
): EventRejection | null {
  const tagId = 'tag' in action && typeof action.tag === 'string' ? action.tag : undefined;
  const r = setEvent(bindingSetOf(app, ref), uid, action, eventCtx(app, tagId));
  if (r.rejected !== undefined) return r.rejected;
  commitSet(app, ref, r.set);
  return null;
}

export function removeEvent(app: StudioApp, ref: ItemRef, uid: string): void {
  const before = bindingSetOf(app, ref);
  const r = clearEvent(before, uid);
  if (r.set !== before) commitSet(app, ref, r.set);
}
