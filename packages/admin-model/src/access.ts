// Quyền hiệu lực (EffectiveAccess) của một phiên và lọc mô hình màn hình theo nó (feature 013; contracts/access-model.md §5,
// admin-api.md §1, §6). Dùng chung cho trang vận hành, trang Quản trị web và "Xem với tư cách" của Studio (feature 027).
// Máy chủ tự lọc mọi đường dữ liệu: ẩn ở đây chỉ là hiển thị, KHÔNG phải bảo mật.
import type { ScreenModel } from '@mat/project-schema';
import type { Role } from './api.ts';

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
