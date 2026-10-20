// Quyền hiệu lực của phiên trên trang vận hành (feature 013, FR-020 đến FR-033; contracts/access-model.md §5,
// admin-api.md §1, §6). Trang tải `GET /api/v1/web/access` sau khi có phiên và dùng nó để:
//  - lọc menu (chỉ `screens` và `pages`), hiện "Không có quyền xem trang này" thay vì lỗi cụt;
//  - bỏ item trong `hiddenItems` khỏi mô hình màn hình (ô lưới để trống), khóa item trong `lockedItems`;
//  - dựng lại khi live báo `access-changed`.
// Máy chủ tự lọc mọi đường dữ liệu: ẩn ở đây chỉ là hiển thị, KHÔNG phải bảo mật. Runtime cũ (404) → không giới hạn.
import type { ScreenModel } from '@mat/project-schema';
import type { Role } from '@mat/ui-components';

export interface EffectiveAccess {
  user: string | null;
  role: Role;
  groups: string[];
  anonymous: boolean;
  storeRev: number;
  usersRev: number;
  projectHash: string;
  /** Màn hình và popup được xem (thứ tự theo project). */
  screens: string[];
  /** Item KHÔNG được xem trên màn hình được xem. */
  hiddenItems: Record<string, string[]>;
  /** Item thao tác được về loại nhưng không có `operate`. */
  lockedItems: Record<string, string[]>;
  /** Trang hệ thống được xem: `alarms`, `history`, `reports`, `watch`. */
  pages: string[];
  admin: boolean;
}

const ROLES: readonly string[] = ['viewer', 'operator', 'engineer', 'administrator'];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const strMap = (v: unknown): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    const list = strs(x);
    if (list.length) out[k] = list;
  }
  return out;
};

/** Thân `EffectiveAccess` (cùng hình C++ và TS); sai hình → null. */
export function parseAccess(body: unknown): EffectiveAccess | null {
  if (!isObj(body) || !Array.isArray(body.screens) || typeof body.role !== 'string') return null;
  if (!ROLES.includes(body.role)) return null;
  return {
    user: typeof body.user === 'string' ? body.user : null,
    role: body.role as Role,
    groups: strs(body.groups),
    anonymous: body.anonymous === true,
    storeRev: typeof body.storeRev === 'number' ? body.storeRev : 0,
    usersRev: typeof body.usersRev === 'number' ? body.usersRev : 0,
    projectHash: typeof body.projectHash === 'string' ? body.projectHash : '',
    screens: strs(body.screens),
    hiddenItems: strMap(body.hiddenItems),
    lockedItems: strMap(body.lockedItems),
    pages: strs(body.pages),
    admin: body.admin === true,
  };
}

export type AccessLoad =
  | { status: 'ok'; access: EffectiveAccess }
  /** Runtime chưa có phân quyền (404) hoặc trang mở bằng HTTP: không giới hạn ở trang. */
  | { status: 'unsupported' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string };

export async function fetchAccess(
  f: typeof fetch = (...a) => fetch(...a),
  url = '/api/v1/web/access',
): Promise<AccessLoad> {
  let res: Response;
  try {
    res = await f(url, { cache: 'no-store' });
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 401) return { status: 'unauthorized' };
  if (res.status === 404 || res.status === 405) return { status: 'unsupported' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  const a = parseAccess(await res.json().catch(() => null));
  return a ? { status: 'ok', access: a } : { status: 'error', message: 'Thân web/access sai hình' };
}

/**
 * Trang còn phiên của `signedIn` mà máy chủ trả quyền của người khác hoặc của ẩn danh (`viewerLogin: off`: phiên bị
 * hủy ở máy chủ thì web/access trả quyền ẩn danh, không 401): phiên đã hết, trang phải coi như hết hạn
 * (SESSION_EXPIRED), không chỉ khóa theo quyền ẩn danh.
 */
export function sessionEnded(load: AccessLoad, signedIn: string | null): boolean {
  if (signedIn === null || load.status !== 'ok') return false;
  return load.access.anonymous || load.access.user !== signedIn;
}

/** Trang hệ thống của trang vận hành ↔ khóa `page:<…>` (access-model §2). */
export type SystemPage = 'alarms' | 'history' | 'reports' | 'watch';

/**
 * Câu hỏi quyền của trang. `access` null (runtime cũ, HTTP, chưa tải): mọi thứ được (máy chủ vẫn là nơi quyết định).
 */
export class AccessView {
  readonly access: EffectiveAccess | null;
  readonly #screens: ReadonlySet<string>;
  readonly #pages: ReadonlySet<string>;

  constructor(access: EffectiveAccess | null) {
    this.access = access;
    this.#screens = new Set(access?.screens ?? []);
    this.#pages = new Set(access?.pages ?? []);
  }

  /** Có giới hạn để áp (đã tải và không phải administrator). */
  get limited(): boolean {
    return this.access !== null && !this.access.admin;
  }

  get admin(): boolean {
    return this.access?.admin === true;
  }

  canView(screen: string): boolean {
    return !this.limited || this.#screens.has(screen);
  }

  page(p: SystemPage): boolean {
    return !this.limited || this.#pages.has(p);
  }

  hidden(screen: string): readonly string[] {
    return this.limited ? (this.access!.hiddenItems[screen] ?? []) : [];
  }

  isLocked(screen: string, item: string): boolean {
    return this.limited && (this.access!.lockedItems[screen]?.includes(item) ?? false);
  }

  /** Cùng quyền (bỏ qua rev): khỏi dựng lại khi `access-changed` không đổi gì với phiên này. */
  same(other: AccessView): boolean {
    const key = (a: EffectiveAccess | null) =>
      a ? JSON.stringify([a.screens, a.hiddenItems, a.lockedItems, a.pages, a.admin, a.role]) : '';
    return key(this.access) === key(other.access);
  }
}

/**
 * Bỏ item trong `hidden` khỏi mô hình (màn hình tự do: bỏ item; lưới: ô trỏ item đó bỏ khóa `item`, ô để trống).
 * Trả chính mô hình khi không có gì để bỏ. Máy chủ đã bỏ trước (admin-api §6); đây là lớp phòng thủ và là đường của
 * "Xem với tư cách" trên trang Quản trị (mô hình của administrator không bị lọc).
 */
export function filterScreen(model: ScreenModel, hidden: readonly string[]): ScreenModel {
  if (!hidden.length) return model;
  const drop = new Set(hidden);
  if (!model.items.some((i) => drop.has(i.id)) && !gridRefs(model, drop)) return model;
  const out = { ...model, items: model.items.filter((i) => !drop.has(i.id)) } as ScreenModel;
  const layout = (model as unknown as { layout?: GridLike }).layout;
  if (layout && layout.mode === 'grid' && Array.isArray(layout.rows)) {
    (out as unknown as { layout: GridLike }).layout = {
      ...layout,
      rows: layout.rows.map((r) => ({
        ...r,
        cells: r.cells.map((c) => {
          if (c.item === undefined || !drop.has(c.item)) return c;
          const { item: _gone, ...rest } = c;
          void _gone;
          return rest;
        }),
      })),
    };
  }
  return out;
}

interface GridLike {
  mode: string;
  rows: Array<
    { cells: Array<{ item?: string } & Record<string, unknown>> } & Record<string, unknown>
  >;
}

function gridRefs(model: ScreenModel, drop: ReadonlySet<string>): boolean {
  const l = (model as unknown as { layout?: GridLike }).layout;
  return Boolean(
    l?.mode === 'grid' &&
    Array.isArray(l.rows) &&
    l.rows.some((r) => r.cells.some((c) => c.item !== undefined && drop.has(c.item))),
  );
}

/** Màn hình được xem nhưng mọi item bị ẩn: trang hiện "Không có nội dung bạn được xem". */
export function emptyForUser(model: ScreenModel, hidden: readonly string[]): boolean {
  return hidden.length > 0 && model.items.length === 0;
}
