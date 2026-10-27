// Quyền hiệu lực của phiên trên trang vận hành (feature 013, FR-020 đến FR-033; contracts/access-model.md §5,
// admin-api.md §1, §6). Trang tải `GET /api/v1/web/access` sau khi có phiên và dùng nó để:
//  - lọc menu (chỉ `screens` và `pages`), hiện "Không có quyền xem trang này" thay vì lỗi cụt;
//  - bỏ item trong `hiddenItems` khỏi mô hình màn hình (ô lưới để trống), khóa item trong `lockedItems`;
//  - dựng lại khi live báo `access-changed`.
// Máy chủ tự lọc mọi đường dữ liệu: ẩn ở đây chỉ là hiển thị, KHÔNG phải bảo mật. Runtime cũ (404) → không giới hạn.
import { parseAccess, type EffectiveAccess } from '@mat/admin-model';

// Dùng chung với Studio (feature 027): kiểu, đọc thân và lọc mô hình nằm ở @mat/admin-model.
export { emptyForUser, filterScreen, parseAccess, type EffectiveAccess } from '@mat/admin-model';

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
