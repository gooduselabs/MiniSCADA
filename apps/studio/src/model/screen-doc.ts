// Tài liệu màn hình: mọi thao tác bất biến của contract studio-screen-editor §2 (feature 007, T103).
// Hàm thuần `(doc, ...args) → { doc, selection?, rejected? }`. Không bao giờ sửa đầu vào; khi không có
// gì đổi hoặc bị từ chối thì trả đúng `doc` cũ (bên gọi không tạo bước hoàn tác rỗng). Chuỗi hiển thị
// không nằm ở đây: lý do từ chối là mã để UI tra i18n.
import {
  LIMITS_03,
  SIZE_MAX,
  SIZE_MIN,
  canonicalItem,
  catalogWidget,
  checkPropValue,
  type Action,
  removeItemRef,
  type FitMode03,
  type GridLayout,
  type Item,
  type PropValue,
  type Rect,
  type Role03,
  type ScreenKind,
  type ScreenModel,
  type WidgetItem,
} from '@mat/project-schema';
import {
  alignRects,
  distributeRects,
  matchRects,
  type AlignKind,
  type DistributeAxis,
  type MatchAxis,
} from './screen-edit/align.ts';
import {
  duplicateItems,
  nextItemId,
  pasteItems,
  PASTE_OFFSET,
  type ClipboardData,
  type PasteResult,
} from './screen-edit/clipboard.ts';
import { reorderItems, type ReorderOp } from './screen-edit/layers.ts';
import {
  catalogMinSizeOf,
  resizeGroup,
  type Handle,
  type MinSizeOf,
} from './screen-edit/resize.ts';

export type Rejection =
  | 'unknown-item'
  | 'unknown-widget'
  | 'max-items'
  | 'bad-prop'
  | 'unknown-slot'
  | 'bad-tag'
  | 'bad-action'
  | 'bad-security'
  | 'bad-screen-prop'
  | 'empty'
  // bố cục lưới (feature 012, grid-ops.ts)
  | 'not-grid'
  | 'unknown-row'
  | 'unknown-cell'
  | 'cell-occupied'
  | 'row-overflow'
  | 'bad-preset'
  | 'max-rows'
  | 'max-cells'
  // feature 035: item svg không nhân bản được
  | 'svg-copy';

export interface EditResult {
  doc: ScreenModel;
  /** Vùng chọn sau thao tác (vắng = giữ nguyên vùng chọn hiện tại). */
  selection?: string[];
  rejected?: Rejection;
}
export interface PasteEditResult extends EditResult {
  /** Màn hình mà hành động của item dán trỏ tới nhưng không có ở đích. */
  missingTargets: string[];
}

type Obj = Record<string, unknown>;
const canon = (it: Item): Item => canonicalItem(it as unknown as Obj) as unknown as Item;
const isRecord = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

const reject = (doc: ScreenModel, rejected: Rejection): EditResult => ({ doc, rejected });
const find = (doc: ScreenModel, id: string): Item | undefined => doc.items.find((i) => i.id === id);
const withItems = (doc: ScreenModel, items: readonly Item[]): ScreenModel => ({
  ...doc,
  items: items as Item[],
});

/** Thay một item bằng bản chuẩn hóa; không đổi nội dung thì trả đúng `doc`. */
function replaceItem(doc: ScreenModel, id: string, next: Item): EditResult {
  const cur = find(doc, id);
  const n = canon(next);
  if (cur !== undefined && JSON.stringify(cur) === JSON.stringify(n))
    return { doc, selection: [id] };
  return {
    doc: withItems(
      doc,
      doc.items.map((i) => (i.id === id ? n : i)),
    ),
    selection: [id],
  };
}

const present = (doc: ScreenModel, ids: readonly string[]): Item[] =>
  [...new Set(ids)].map((id) => find(doc, id)).filter((i): i is Item => i !== undefined);

const rectOf = (it: Item): Rect => ({ x: it.x, y: it.y, width: it.width, height: it.height });
const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Áp hình học mới cho các item chọn (theo thứ tự `ids`). `compute` nhận hình chữ nhật của các item
 * (gồm cả item khóa nếu `withLocked`, để làm mốc) và trả danh sách cùng thứ tự; item khóa không bao giờ
 * bị đổi.
 */
function applyRects(
  doc: ScreenModel,
  ids: readonly string[],
  withLocked: boolean,
  compute: (items: Item[]) => Rect[],
): EditResult {
  const chosen = present(doc, ids);
  const selection = chosen.map((i) => i.id);
  const input = withLocked ? chosen : chosen.filter((i) => i.locked !== true);
  if (input.length === 0) return { doc, selection };
  const rects = compute(input);
  const byId = new Map<string, Rect>();
  input.forEach((it, k) => {
    const r = rects[k]!;
    if (it.locked !== true && !sameRect(rectOf(it), r)) byId.set(it.id, r);
  });
  if (byId.size === 0) return { doc, selection };
  const items = doc.items.map((it) => {
    const r = byId.get(it.id);
    return r ? canon({ ...it, ...r }) : it;
  });
  return { doc: withItems(doc, items), selection };
}

const intOf = (n: number): number => Math.round(n);

/** Thêm widget ở (x, y) = góc trên trái; cỡ mặc định theo danh mục, `props` rỗng. */
export function addWidget(
  doc: ScreenModel,
  type: string,
  at: { x: number; y: number },
): EditResult {
  const spec = catalogWidget(type);
  if (spec === undefined) return reject(doc, 'unknown-widget');
  if (doc.items.length >= LIMITS_03.items) return reject(doc, 'max-items');
  const used = new Set(doc.items.map((i) => i.id));
  const id = nextItemId(type.replace(/-/g, '_'), used);
  const it = canon({
    id,
    type: 'widget',
    widget: type,
    x: intOf(at.x),
    y: intOf(at.y),
    width: spec.defaultSize[0],
    height: spec.defaultSize[1],
  });
  return { doc: withItems(doc, [...doc.items, it]), selection: [id] };
}

/** Dịch các item (bỏ item khóa) `dx`, `dy` đơn vị thiết kế, làm tròn. */
export function moveItems(
  doc: ScreenModel,
  ids: readonly string[],
  dx: number,
  dy: number,
): EditResult {
  const ox = intOf(dx);
  const oy = intOf(dy);
  return applyRects(doc, ids, false, (items) =>
    items.map((it) => ({ ...rectOf(it), x: it.x + ox, y: it.y + oy })),
  );
}

/** Đặt một phần hình chữ nhật; kẹp về cỡ tối thiểu theo danh mục. Dùng cho ô X, Y, Rộng, Cao. */
export function setRect(
  doc: ScreenModel,
  id: string,
  rect: Partial<Rect>,
  minSizeOf: MinSizeOf = catalogMinSizeOf,
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  const min = minSizeOf(it);
  const next = {
    ...it,
    x: intOf(rect.x ?? it.x),
    y: intOf(rect.y ?? it.y),
    width: Math.max(min.width, intOf(rect.width ?? it.width)),
    height: Math.max(min.height, intOf(rect.height ?? it.height)),
  };
  return replaceItem(doc, id, next);
}

export interface ResizeItemsOptions {
  keepRatio?: boolean;
  minSizeOf?: MinSizeOf;
}

/** Đổi cỡ theo tay nắm; nhiều item co tỉ lệ theo hộp bao. `delta` theo đơn vị thiết kế. */
export function resizeItems(
  doc: ScreenModel,
  ids: readonly string[],
  handle: Handle,
  delta: { dx: number; dy: number },
  opts: ResizeItemsOptions = {},
): EditResult {
  const minOf = opts.minSizeOf ?? catalogMinSizeOf;
  return applyRects(doc, ids, false, (items) =>
    resizeGroup(items.map(rectOf), handle, delta.dx, delta.dy, {
      mins: items.map(minOf),
      keepRatio: opts.keepRatio === true,
    }),
  );
}

export function alignItems(doc: ScreenModel, ids: readonly string[], kind: AlignKind): EditResult {
  return applyRects(doc, ids, true, (items) => alignRects(items.map(rectOf), kind));
}

export function distributeItems(
  doc: ScreenModel,
  ids: readonly string[],
  axis: DistributeAxis,
): EditResult {
  return applyRects(doc, ids, true, (items) => distributeRects(items.map(rectOf), axis));
}

/** Cùng rộng/cao theo item đầu của `ids` (item chính, kể cả khi bị khóa); kẹp tối thiểu từng item. */
export function matchSize(
  doc: ScreenModel,
  ids: readonly string[],
  axis: MatchAxis,
  minSizeOf: MinSizeOf = catalogMinSizeOf,
): EditResult {
  return applyRects(doc, ids, true, (items) =>
    matchRects(items.map(rectOf), axis, 0).map((r, k) => {
      const min = minSizeOf(items[k]!);
      return { ...r, width: Math.max(r.width, min.width), height: Math.max(r.height, min.height) };
    }),
  );
}

export function reorder(doc: ScreenModel, ids: readonly string[], op: ReorderOp): EditResult {
  const selection = present(doc, ids).map((i) => i.id);
  const items = reorderItems(doc.items, ids, op);
  return { doc: items === doc.items ? doc : withItems(doc, items), selection };
}

/** Đặt thuộc tính tĩnh (kiểm theo danh mục); `undefined` = về mặc định (bỏ khóa). */
export function setProp(
  doc: ScreenModel,
  id: string,
  name: string,
  value: PropValue | undefined,
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  if (it.type !== 'widget') return reject(doc, 'bad-prop');
  const prop = catalogWidget(it.widget)?.props.find((p) => p.name === name);
  if (prop === undefined) return reject(doc, 'bad-prop');
  const props: Record<string, PropValue> = { ...(it.props ?? {}) };
  if (value === undefined) delete props[name];
  else {
    if (checkPropValue(prop, value) !== null) return reject(doc, 'bad-prop');
    props[name] = value;
  }
  const next: WidgetItem = { ...it, props };
  if (Object.keys(props).length === 0) delete next.props;
  return replaceItem(doc, id, next);
}

/** Gắn Tag vào khe: một id (khe thường), mảng id (khe `multi`, 1..max, không trùng) hoặc `null` để gỡ. */
export function setTag(
  doc: ScreenModel,
  id: string,
  slotName: string,
  tag: string | string[] | null,
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  if (it.type !== 'widget') return reject(doc, 'unknown-slot');
  const slot = catalogWidget(it.widget)?.slots.find((s) => s.name === slotName);
  if (slot === undefined) return reject(doc, 'unknown-slot');
  const tags: Record<string, string | string[]> = { ...(it.tags ?? {}) };
  let value: string | string[] | null = tag;
  if (value !== null && slot.multi) {
    const arr = typeof value === 'string' ? [value] : value;
    if (arr.length === 0) value = null;
    else if (
      arr.length > (slot.max ?? Infinity) ||
      arr.some((t) => typeof t !== 'string' || t === '') ||
      new Set(arr).size !== arr.length
    )
      return reject(doc, 'bad-tag');
    else value = arr;
  } else if (value !== null && (typeof value !== 'string' || value === '')) {
    return reject(doc, 'bad-tag');
  }
  if (value === null) delete tags[slotName];
  else tags[slotName] = value;
  const next: WidgetItem = { ...it, tags };
  if (Object.keys(tags).length === 0) delete next.tags;
  return replaceItem(doc, id, next);
}

/** Dựng hành động sạch (chỉ khóa hợp lệ) hoặc `null` nếu sai hình. */
function cleanAction(a: Action): Action | null {
  switch (a.action) {
    case 'write':
      return typeof a.value === 'boolean' ||
        typeof a.value === 'string' ||
        (typeof a.value === 'number' && Number.isFinite(a.value))
        ? { action: 'write', value: a.value }
        : null;
    case 'toggle':
      return { action: 'toggle' };
    case 'closePopup':
      return { action: 'closePopup' };
    case 'pulse':
      return typeof a.value === 'boolean' &&
        Number.isInteger(a.durationMs) &&
        a.durationMs >= 100 &&
        a.durationMs <= 10000
        ? { action: 'pulse', value: a.value, durationMs: a.durationMs }
        : null;
    case 'navigate':
      return typeof a.screen === 'string' && a.screen !== ''
        ? { action: a.action, screen: a.screen }
        : null;
    case 'popup': {
      // định dạng 1.0 (faceplate): `args` tên → chuỗi; kiểm theo `params` của popup đích là việc của bộ kiểm (E_POPUP_ARGS)
      if (typeof a.screen !== 'string' || a.screen === '') return null;
      const args = (a as { args?: unknown }).args;
      if (args === undefined) return { action: 'popup', screen: a.screen };
      if (!isRecord(args) || Object.values(args).some((v) => typeof v !== 'string')) return null;
      if (Object.keys(args).length === 0) return { action: 'popup', screen: a.screen };
      return { action: 'popup', screen: a.screen, args: { ...args } } as Action;
    }
    default:
      return null;
  }
}

/** Đặt (hoặc gỡ bằng `null`) hành động của sự kiện; kiểm theo danh sách hành động của danh mục. */
export function setAction(
  doc: ScreenModel,
  id: string,
  event: 'click',
  action: Action | null,
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  if (it.type !== 'widget') return reject(doc, 'bad-action');
  const ev = catalogWidget(it.widget)?.events.find((e) => e.name === event);
  if (ev === undefined) return reject(doc, 'bad-action');
  const events = { ...(it.events ?? {}) };
  if (action === null) delete events[event];
  else {
    const clean = isRecord(action) ? cleanAction(action) : null;
    if (clean === null || !ev.actions.includes(clean.action)) return reject(doc, 'bad-action');
    events[event] = clean;
  }
  const next: WidgetItem = { ...it, events };
  if (Object.keys(events).length === 0) delete next.events;
  return replaceItem(doc, id, next);
}

/** Vai trò tối thiểu để điều khiển; `null` hoặc mặc định của danh mục thì bỏ khóa. */
export function setSecurity(
  doc: ScreenModel,
  id: string,
  minRole: Exclude<Role03, 'viewer'> | null,
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  if (it.type !== 'widget') return reject(doc, 'bad-security');
  const sec = catalogWidget(it.widget)?.security;
  if (sec === undefined || (minRole !== null && !sec.minRole.includes(minRole)))
    return reject(doc, 'bad-security');
  const next: WidgetItem = { ...it };
  if (minRole === null) delete next.security;
  else next.security = { minRole };
  return replaceItem(doc, id, next);
}

const ROLE_ORDER: readonly Role03[] = ['viewer', 'operator', 'engineer', 'administrator'];
const roleRank = (r: string): number => (ROLE_ORDER as readonly string[]).indexOf(r);

/** Sửa vai trò tối thiểu của item (định dạng 1.1, feature 013); `null` bỏ khóa, vắng thì giữ. */
export interface AccessPatch {
  view?: Role03 | null;
  operate?: Role03 | null;
}

/**
 * Vai trò tối thiểu để xem (`security.view`) và để thao tác (`security.operate`) của item (contracts/access-model.md
 * §3, luật E_SECURITY_* của tests/project-vectors/README-013.md). `operate` chỉ cho item thao tác được: widget nhóm
 * `control`, hoặc item svg mà bên gọi báo có sự kiện ghi (`svgOperable`, tính từ tệp binding). Đặt `operate` thì bỏ
 * `minRole` (bí danh cũ). Từ chối `operate: viewer` và `operate` thấp hơn `view`; nâng `view` trên mức thao tác đã khai
 * thì mức thao tác được nâng theo. Giá trị mặc định (viewer, operator) được bỏ khi chuẩn hóa.
 */
export function setItemAccess(
  doc: ScreenModel,
  id: string,
  patch: AccessPatch,
  opts: { svgOperable?: boolean } = {},
): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  const operable =
    it.type === 'widget'
      ? catalogWidget(it.widget)?.group === 'control'
      : opts.svgOperable === true;
  const cur: { view?: Role03; operate?: Role03; minRole?: Role03 } = { ...(it.security ?? {}) };
  if (patch.view !== undefined) {
    if (patch.view === null) delete cur.view;
    else if (roleRank(patch.view) < 0) return reject(doc, 'bad-security');
    else cur.view = patch.view;
  }
  if (patch.operate !== undefined) {
    if (patch.operate !== null && (!operable || roleRank(patch.operate) < 1))
      return reject(doc, 'bad-security');
    delete cur.minRole;
    if (patch.operate === null) delete cur.operate;
    else cur.operate = patch.operate;
  }
  const view = cur.view ?? 'viewer';
  const explicit = cur.operate ?? cur.minRole;
  if (explicit !== undefined && roleRank(explicit) < roleRank(view)) {
    if (patch.operate !== undefined && patch.operate !== null) return reject(doc, 'bad-security');
    delete cur.minRole;
    cur.operate = view;
  }
  const next = { ...it } as Item & { security?: typeof cur };
  if (Object.keys(cur).length === 0) delete next.security;
  else next.security = cur;
  return replaceItem(doc, id, next as Item);
}

/** Đổi tên hiển thị của item; chuỗi rỗng bỏ khóa `name`. */
export function rename(doc: ScreenModel, id: string, name: string): EditResult {
  const it = find(doc, id);
  if (it === undefined) return reject(doc, 'unknown-item');
  const next = { ...it };
  if (name.trim() === '') delete next.name;
  else next.name = name;
  return replaceItem(doc, id, next);
}

function setFlag(
  doc: ScreenModel,
  ids: readonly string[],
  key: 'locked' | 'hidden',
  on: boolean,
): EditResult {
  const chosen = present(doc, ids);
  const selection = chosen.map((i) => i.id);
  const set = new Set(selection);
  let changed = false;
  const items = doc.items.map((it) => {
    if (!set.has(it.id) || (it[key] === true) === on) return it;
    changed = true;
    const next = { ...it, [key]: on };
    return canon(next);
  });
  return { doc: changed ? withItems(doc, items) : doc, selection };
}
export const setLocked = (doc: ScreenModel, ids: readonly string[], locked: boolean): EditResult =>
  setFlag(doc, ids, 'locked', locked);
export const setHidden = (doc: ScreenModel, ids: readonly string[], hidden: boolean): EditResult =>
  setFlag(doc, ids, 'hidden', hidden);

const fromPaste = (doc: ScreenModel, r: PasteResult): PasteEditResult =>
  r.rejected === undefined
    ? {
        doc: withItems(doc, r.items),
        selection: r.ids,
        missingTargets: r.missingTargets,
      }
    : { doc, rejected: r.rejected, missingTargets: [] };

/** Nhân bản (Ctrl+D): bản sao lệch (+20, +20), chọn các bản mới. */
export function duplicate(doc: ScreenModel, ids: readonly string[]): PasteEditResult {
  return fromPaste(doc, duplicateItems(doc, ids));
}

/** Dán từ clipboard của Studio; `knownScreens` (nếu có) để báo `missingTargets`. */
export function paste(
  doc: ScreenModel,
  clip: ClipboardData,
  offset: { x: number; y: number } = PASTE_OFFSET,
  knownScreens?: readonly string[],
): PasteEditResult {
  return fromPaste(doc, pasteItems(doc, clip, { offset, knownScreens }));
}

export function remove(doc: ScreenModel, ids: readonly string[]): EditResult {
  const gone = new Set(ids);
  const items = doc.items.filter((it) => !gone.has(it.id));
  if (items.length === doc.items.length) return { doc, selection: [] };
  const next = withItems(doc, items) as ScreenModel & { layout?: GridLayout };
  // màn hình lưới (định dạng 1.1): ô trỏ tới item bị xóa thành ô trống
  if (next.layout) {
    let layout = next.layout;
    for (const id of gone) layout = removeItemRef(layout, id);
    next.layout = layout;
  }
  return { doc: next, selection: [] };
}

export interface ScreenProps {
  name?: string;
  kind?: ScreenKind;
  size?: { width: number; height: number };
  /** `null` bỏ khóa (về mặc định). */
  fitMode?: FitMode03 | null;
  background?: string | null;
  /** Định dạng 1.1 (feature 013): vai trò tối thiểu để xem màn hình; `null` hoặc viewer bỏ khóa. */
  view?: Role03 | null;
}
const FIT_MODES: readonly FitMode03[] = ['contain', 'cover', 'stretch', 'fit-width', 'none'];
const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/** Thuộc tính của cả màn hình; `id` không đổi. Cỡ kẹp trong khoảng cho phép. */
export function setScreenProps(doc: ScreenModel, p: ScreenProps): EditResult {
  const next: ScreenModel = { ...doc };
  if (p.name !== undefined) {
    if (p.name.trim() === '') return reject(doc, 'bad-screen-prop');
    next.name = p.name;
  }
  if (p.kind !== undefined) {
    if (p.kind !== 'screen' && p.kind !== 'popup') return reject(doc, 'bad-screen-prop');
    next.kind = p.kind;
  }
  if (p.size !== undefined) {
    if (!Number.isFinite(p.size.width) || !Number.isFinite(p.size.height))
      return reject(doc, 'bad-screen-prop');
    next.size = {
      width: clampInt(p.size.width, SIZE_MIN.width, SIZE_MAX.width),
      height: clampInt(p.size.height, SIZE_MIN.height, SIZE_MAX.height),
    };
  }
  if (p.fitMode !== undefined) {
    if (p.fitMode === null) delete next.fitMode;
    else if (!FIT_MODES.includes(p.fitMode)) return reject(doc, 'bad-screen-prop');
    else next.fitMode = p.fitMode;
  }
  if (p.background !== undefined) {
    if (p.background === null) delete next.background;
    else if (!/^#[0-9a-fA-F]{6}$/.test(p.background)) return reject(doc, 'bad-screen-prop');
    else next.background = p.background;
  }
  if (p.view !== undefined) {
    if (p.view !== null && roleRank(p.view) < 0) return reject(doc, 'bad-screen-prop');
    if (p.view === null || p.view === 'viewer') delete next.security;
    else next.security = { view: p.view };
  }
  return JSON.stringify(next) === JSON.stringify(doc) ? { doc } : { doc: next };
}
