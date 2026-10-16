// Binding và sự kiện của một item `svg` (feature 008, T068 và phần model của T081; contract studio-svg-editor §5, §8,
// §11; data-model §6 `SvgBindingDoc`). Hàm thuần `(set, ...) → { set, rejected? }`: không sửa đầu vào; không đổi hoặc bị từ
// chối thì trả đúng `set` cũ (bên gọi không tạo bước hoàn tác rỗng). Mỗi hàm là MỘT thao tác nên bên gọi ghi đúng một
// bước hoàn tác (store.edit([{ kind: 'svgBindings', ... }])). Lý do từ chối là mã để UI tra i18n.
import type {
  Binding04,
  BindingSet04,
  ElementAction,
  ElementActionName,
  ElementEntry04,
} from '@mat/project-schema';
import {
  rowAcceptsKind,
  rowAcceptsTag,
  rowOfBinding,
  tagClassOf04,
  transformsFor,
  type ElementKind,
} from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';

export type BindRejection =
  | 'unknown-row'
  | 'unknown-element'
  | 'unknown-binding'
  | 'unknown-tag'
  | 'element-kind'
  | 'tag-type'
  | 'transform'
  | 'duplicate-group'
  | 'too-many'
  | 'bad-event';

export type EventRejection =
  | 'bad-action'
  | 'bad-tag'
  | 'not-writable'
  | 'not-bool'
  | 'bad-value'
  | 'bad-duration'
  | 'bad-confirm'
  | 'bad-role'
  | 'bad-label'
  | 'bad-screen'
  | 'wrong-screen-kind';

export interface BindResult {
  set: BindingSet04;
  /** `id` của binding vừa thêm hoặc sửa. */
  id?: string;
  rejected?: BindRejection;
}
export interface EventResult {
  set: BindingSet04;
  rejected?: EventRejection;
}

/** Ngữ cảnh kiểm một binding: loại phần tử và thông tin Tag. */
export interface BindCtx {
  elementKind: ElementKind;
  tag: TagInfo | undefined;
}

export const MAX_BINDINGS_PER_ELEMENT = 16;
export const LABEL_MAX = 80;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const cpLen = (s: string): number => [...s].length;

export const emptyBindingSet = (
  screenId: string,
  itemId: string,
  version = '0.4.0',
): BindingSet04 => ({
  schemaVersion: version,
  screenId,
  itemId,
  elements: [],
});

const indexOfUid = (set: BindingSet04, uid: string): number =>
  set.elements.findIndex((e) => e.elementUid === uid);

export const elementOf = (set: BindingSet04, uid: string): ElementEntry04 | undefined =>
  set.elements.find((e) => e.elementUid === uid);

/** Id binding mới `<gốc>`, `<gốc>_2`, ... chưa dùng trong cả file. */
export function nextBindingId(set: BindingSet04, base: string): string {
  const used = new Set<string>();
  for (const e of set.elements) for (const b of e.bindings ?? []) used.add(b.id);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

const isEmptyEntry = (e: ElementEntry04): boolean =>
  (e.bindings === undefined || e.bindings.length === 0) && e.events?.click === undefined;

/** Gọn: bỏ `bindings` rỗng, bỏ `events` rỗng, bỏ phần tử rỗng. */
function tidy(set: BindingSet04): BindingSet04 {
  const elements: ElementEntry04[] = [];
  for (const e of set.elements) {
    const out: ElementEntry04 = { elementUid: e.elementUid };
    if (e.bindings !== undefined && e.bindings.length > 0) out.bindings = e.bindings;
    if (e.events?.click !== undefined) out.events = e.events;
    if (!isEmptyEntry(out)) elements.push(out);
  }
  return { ...set, elements };
}

/** Kiểm một binding theo loại phần tử và Tag; trả lý do hoặc null. */
export function checkBinding(
  b: Pick<Binding04, 'target' | 'animation' | 'transform'>,
  ctx: BindCtx,
): BindRejection | null {
  const row = rowOfBinding(b);
  if (row === undefined) return 'unknown-row';
  if (!rowAcceptsKind(row, ctx.elementKind)) return 'element-kind';
  if (ctx.tag === undefined) return 'unknown-tag';
  if (!rowAcceptsTag(row, ctx.tag)) return 'tag-type';
  if (!transformsFor(row, ctx.tag).includes(b.transform.kind)) return 'transform';
  return null;
}

const groupOf = (b: Pick<Binding04, 'target' | 'animation'>): string =>
  rowOfBinding(b)?.group ?? b.target;

const reject = (set: BindingSet04, rejected: BindRejection): BindResult => ({ set, rejected });

/** Thêm binding (`id` vắng thì tự sinh theo mục). Hai binding cùng nhóm đích trên một phần tử bị từ chối. */
export function addBinding(
  set: BindingSet04,
  uid: string,
  binding: Omit<Binding04, 'id'> & { id?: string },
  ctx: BindCtx,
): BindResult {
  const why = checkBinding(binding, ctx);
  if (why !== null) return reject(set, why);
  const entry = elementOf(set, uid);
  const list = entry?.bindings ?? [];
  if (list.length >= MAX_BINDINGS_PER_ELEMENT) return reject(set, 'too-many');
  const group = groupOf(binding);
  if (list.some((x) => groupOf(x) === group)) return reject(set, 'duplicate-group');
  const base = rowOfBinding(binding)?.id ?? 'bind';
  const id =
    binding.id !== undefined && !allIds(set).has(binding.id)
      ? binding.id
      : nextBindingId(set, base);
  const nb = { ...clone(binding), id } as Binding04;
  const next = clone(set);
  const at = indexOfUid(next, uid);
  if (at < 0) next.elements.push({ elementUid: uid, bindings: [nb] });
  else (next.elements[at]!.bindings ??= []).push(nb);
  return { set: next, id };
}

function allIds(set: BindingSet04): Set<string> {
  const used = new Set<string>();
  for (const e of set.elements) for (const b of e.bindings ?? []) used.add(b.id);
  return used;
}

/**
 * Sửa binding bằng `patch` (khóa `undefined` thì bỏ khóa). Đổi đích sang nhóm khác phải không trùng nhóm của binding khác;
 * kết quả phải hợp loại phần tử và Tag.
 */
export function updateBinding(
  set: BindingSet04,
  uid: string,
  bindingId: string,
  patch: Partial<Binding04>,
  ctx: BindCtx,
): BindResult {
  const entry = elementOf(set, uid);
  if (entry === undefined) return reject(set, 'unknown-element');
  const old = entry.bindings?.find((b) => b.id === bindingId);
  if (old === undefined) return reject(set, 'unknown-binding');
  const merged: Record<string, unknown> = { ...clone(old) };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id') continue;
    if (v === undefined) delete merged[k];
    else merged[k] = clone(v);
  }
  const nb = merged as unknown as Binding04;
  if (JSON.stringify(nb) === JSON.stringify(old)) return { set, id: bindingId };
  const why = checkBinding(nb, ctx);
  if (why !== null) return reject(set, why);
  const group = groupOf(nb);
  if ((entry.bindings ?? []).some((x) => x.id !== bindingId && groupOf(x) === group))
    return reject(set, 'duplicate-group');
  const next = clone(set);
  const list = next.elements[indexOfUid(next, uid)]!.bindings!;
  list[list.findIndex((b) => b.id === bindingId)] = nb;
  return { set: next, id: bindingId };
}

export function removeBinding(set: BindingSet04, uid: string, bindingId: string): BindResult {
  const entry = elementOf(set, uid);
  if (entry === undefined) return reject(set, 'unknown-element');
  if (!entry.bindings?.some((b) => b.id === bindingId)) return reject(set, 'unknown-binding');
  const next = clone(set);
  const e = next.elements[indexOfUid(next, uid)]!;
  e.bindings = e.bindings!.filter((b) => b.id !== bindingId);
  return { set: tidy(next) };
}

/** Bộ binding của một phần tử để dán (bản sao). Rỗng nếu phần tử không có binding. */
export const copyBindings = (set: BindingSet04, uid: string): Binding04[] =>
  clone(elementOf(set, uid)?.bindings ?? []);

export interface ApplySkip {
  uid: string;
  bindingId: string;
  reason: BindRejection;
}
export interface ApplyResult {
  set: BindingSet04;
  applied: Array<{ uid: string; id: string }>;
  skipped: ApplySkip[];
}

/**
 * Áp bộ binding cho nhiều phần tử (Shift+nhấp, dán): binding cùng nhóm đích đã có thì thay; binding không hợp loại
 * phần tử hoặc Tag thì bỏ qua và báo trong `skipped`. Một bước hoàn tác.
 */
export function applyToMany(
  set: BindingSet04,
  uids: readonly string[],
  bindings: readonly Binding04[],
  ctxOf: (uid: string, b: Binding04) => BindCtx,
): ApplyResult {
  let cur = clone(set);
  const applied: ApplyResult['applied'] = [];
  const skipped: ApplySkip[] = [];
  for (const uid of uids) {
    for (const b of bindings) {
      const ctx = ctxOf(uid, b);
      const why = checkBinding(b, ctx);
      if (why !== null) {
        skipped.push({ uid, bindingId: b.id, reason: why });
        continue;
      }
      const group = groupOf(b);
      const existing = elementOf(cur, uid)?.bindings?.find((x) => groupOf(x) === group);
      if (existing !== undefined) cur = removeBinding(cur, uid, existing.id).set;
      const r = addBinding(cur, uid, { ...clone(b), id: undefined }, ctx);
      if (r.rejected !== undefined) {
        skipped.push({ uid, bindingId: b.id, reason: r.rejected });
        continue;
      }
      cur = r.set;
      applied.push({ uid, id: r.id! });
    }
  }
  return { set: applied.length === 0 ? set : cur, applied, skipped };
}

export interface RenameTagResult {
  set: BindingSet04;
  /** Số chỗ đã đổi (binding và sự kiện). */
  count: number;
}

/** Đổi Tag `from` thành `to` ở mọi binding và sự kiện ghi của file; không có chỗ nào thì trả đúng `set`. */
export function renameTagInSet(set: BindingSet04, from: string, to: string): RenameTagResult {
  let count = 0;
  const elements = set.elements.map((e) => {
    let out = e;
    if (e.bindings?.some((b) => b.source.tagId === from)) {
      out = {
        ...out,
        bindings: e.bindings.map((b) => {
          if (b.source.tagId !== from) return b;
          count++;
          return { ...b, source: { ...b.source, tagId: to } };
        }),
      };
    }
    const c = e.events?.click;
    if (c !== undefined && 'tag' in c && c.tag === from) {
      count++;
      out = { ...out, events: { ...e.events, click: { ...c, tag: to } as ElementAction } };
    }
    return out;
  });
  return count === 0 ? { set, count } : { set: { ...set, elements }, count };
}

// ---- Sự kiện (T081, phần model) ----

export interface ScreenRefInfo {
  id: string;
  kind: 'screen' | 'popup';
}
export interface EventCtx {
  screens: readonly ScreenRefInfo[];
  /** Tag của hành động ghi. */
  tag?: TagInfo | undefined;
}

const WRITE_ACTIONS: readonly ElementActionName[] = ['write', 'toggle', 'pulse'];
const MIN_ROLES = ['operator', 'engineer', 'administrator'];

/** Tag ghi được từ sự kiện: RW thật (không `calculated`, Tag mô phỏng chỉ khi nhập tay). */
export function eventWritable(tag: TagInfo): boolean {
  if (tag.access !== 'RW' || tag.kind === 'calculated') return false;
  if (tag.kind === 'simulation' && tag.sim?.kind !== 'manual') return false;
  return true;
}

/** Kiểm hành động `click`; trả lý do hoặc null. */
export function checkEvent(a: ElementAction, ctx: EventCtx): EventRejection | null {
  if (a.action === 'closePopup') return checkExtras(a);
  if (a.action === 'navigate' || a.action === 'popup') {
    const s = ctx.screens.find((x) => x.id === a.screen);
    if (s === undefined) return 'bad-screen';
    if (s.kind !== (a.action === 'navigate' ? 'screen' : 'popup')) return 'wrong-screen-kind';
    return checkExtras(a);
  }
  if (!WRITE_ACTIONS.includes(a.action)) return 'bad-action';
  const tag = ctx.tag;
  if (tag === undefined || tag.id !== a.tag) return 'bad-tag';
  if (!eventWritable(tag)) return 'not-writable';
  const cls = tagClassOf04(tag.type);
  if ((a.action === 'toggle' || a.action === 'pulse') && cls !== 'bool') return 'not-bool';
  if (a.action === 'write') {
    const v = a.value;
    const ok =
      cls === 'bool'
        ? typeof v === 'boolean'
        : cls === 'string'
          ? typeof v === 'string'
          : typeof v === 'number' && Number.isFinite(v);
    if (!ok) return 'bad-value';
    if (typeof v === 'number') {
      const lo = tag.limits?.min ?? tag.min;
      const hi = tag.limits?.max ?? tag.max;
      if ((lo !== undefined && v < lo) || (hi !== undefined && v > hi)) return 'bad-value';
    }
  }
  if (a.action === 'pulse') {
    if (typeof a.value !== 'boolean') return 'bad-value';
    if (!Number.isInteger(a.durationMs) || a.durationMs < 100 || a.durationMs > 10000)
      return 'bad-duration';
  }
  if (a.confirm !== undefined && a.confirm !== 'always' && a.confirm !== 'none')
    return 'bad-confirm';
  if (a.confirm === 'none' && cls !== 'bool') return 'bad-confirm';
  return checkExtras(a);
}

function checkExtras(a: ElementAction): EventRejection | null {
  const x = a as { minRole?: string; label?: string };
  if (x.minRole !== undefined && !MIN_ROLES.includes(x.minRole)) return 'bad-role';
  if (x.label !== undefined && cpLen(x.label) > LABEL_MAX) return 'bad-label';
  return null;
}

/** Đặt (hoặc thay) sự kiện nhấp của phần tử. Khóa `undefined` của hành động bị bỏ. */
export function setEvent(
  set: BindingSet04,
  uid: string,
  action: ElementAction,
  ctx: EventCtx,
): EventResult {
  const why = checkEvent(action, ctx);
  if (why !== null) return { set, rejected: why };
  const clean = Object.fromEntries(
    Object.entries(action).filter(([, v]) => v !== undefined),
  ) as unknown as ElementAction;
  const entry = elementOf(set, uid);
  if (
    entry?.events?.click !== undefined &&
    JSON.stringify(entry.events.click) === JSON.stringify(clean)
  )
    return { set };
  const next = clone(set);
  const at = indexOfUid(next, uid);
  if (at < 0) next.elements.push({ elementUid: uid, events: { click: clean } });
  else next.elements[at]!.events = { click: clean };
  return { set: next };
}

export function clearEvent(set: BindingSet04, uid: string): BindResult {
  const entry = elementOf(set, uid);
  if (entry === undefined) return reject(set, 'unknown-element');
  if (entry.events?.click === undefined) return { set };
  const next = clone(set);
  delete next.elements[indexOfUid(next, uid)]!.events;
  return { set: tidy(next) };
}

/** `minRole` của sự kiện (nhóm Sự kiện và nhóm Bảo mật dùng cùng một giá trị). */
export const eventMinRole = (set: BindingSet04, uid: string): string | undefined =>
  (elementOf(set, uid)?.events?.click as { minRole?: string } | undefined)?.minRole;

/** Đặt `minRole` của sự kiện (undefined: bỏ). Phần tử chưa có sự kiện thì từ chối. */
export function setEventMinRole(
  set: BindingSet04,
  uid: string,
  minRole: 'operator' | 'engineer' | 'administrator' | undefined,
  ctx: EventCtx,
): EventResult {
  const c = elementOf(set, uid)?.events?.click;
  if (c === undefined) return { set, rejected: 'bad-action' };
  if (c.action === 'navigate' || c.action === 'popup' || c.action === 'closePopup')
    return { set, rejected: 'bad-role' };
  return setEvent(set, uid, { ...c, minRole } as ElementAction, ctx);
}
