// Logic thuần của trang Quản trị (feature 013): người nhận của quy tắc, bản nháp thay đổi quy tắc (lưu theo lô với
// `rev`), kế hoạch sửa người dùng (khi nào cần xác nhận lại), mã nhóm từ tên, thời gian tương đối. Không DOM.
import type { EffectiveAccess } from '../access.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AccessResource, AccessRule, AdminGroup, AdminUser, Level, Role } from './api.ts';

export const RANK: Record<Role, number> = { viewer: 0, operator: 1, engineer: 2, administrator: 3 };

export type GranteeCat = 'all' | 'role' | 'group' | 'user';
export interface GranteeOption {
  id: string;
  label: string;
  short: string;
  cat: GranteeCat;
  /** Chỉ số màu (0–11) cho chip, ổn định theo vị trí. */
  hue: number;
}

/** Mọi người nhận chọn được: `*`, vai trò (trừ administrator: luôn được), nhóm, người dùng. */
export function granteeOptions(
  groups: readonly AdminGroup[],
  users: readonly AdminUser[],
): GranteeOption[] {
  const g = viAdmin.grantees;
  const out: GranteeOption[] = [{ id: '*', label: g.all, short: g.all, cat: 'all', hue: 0 }];
  (['viewer', 'operator', 'engineer'] as const).forEach((r, i) =>
    out.push({ id: `role:${r}`, label: g.role(r), short: g.roleShort(r), cat: 'role', hue: 1 + i }),
  );
  groups.forEach((x, i) =>
    out.push({
      id: `group:${x.id}`,
      label: g.group(x.name),
      short: x.name,
      cat: 'group',
      hue: (4 + i) % 12,
    }),
  );
  users.forEach((u, i) =>
    out.push({
      id: `user:${u.name}`,
      label: g.user(u.name),
      short: u.name,
      cat: 'user',
      hue: (8 + i) % 12,
    }),
  );
  return out;
}

/** Tập người nhận tương đương mặc định của project (dùng làm điểm bắt đầu khi sửa một hàng đang mặc định). */
export function defaultGrantees(def: Role | undefined): string[] {
  return !def || def === 'viewer' ? ['*'] : [`role:${def}`];
}

const key = (resource: string, level: Level) => `${resource}|${level}`;
const sameSet = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === null || b === null
    ? a === b
    : a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

export interface RuleState {
  /** Người nhận hiện hành (gồm thay đổi chưa lưu); null = không có quy tắc (mặc định của project). */
  grantees: string[] | null;
  /** Có thay đổi chưa lưu. */
  dirty: boolean;
}

/** Bản nháp quy tắc: thay đổi gom lại, lưu một lần (`POST /api/v1/admin/access` với `rev`). */
export class RuleDraft {
  #base = new Map<string, string[]>();
  #edits = new Map<string, string[] | null>();
  readonly #listeners = new Set<() => void>();

  constructor(rules: readonly AccessRule[] = []) {
    this.load(rules);
  }

  /** Thay quy tắc đã lưu (sau khi tải lại); giữ thay đổi chưa lưu khác với bản mới. */
  load(rules: readonly AccessRule[], keepEdits = false): void {
    this.#base = new Map(rules.map((r) => [key(r.resource, r.level), [...r.grantees]]));
    if (!keepEdits) this.#edits.clear();
    else
      for (const [k, v] of [...this.#edits])
        if (sameSet(v, this.#base.get(k) ?? null)) this.#edits.delete(k);
    this.#emit();
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(): void {
    for (const fn of [...this.#listeners]) fn();
  }

  get(resource: string, level: Level): RuleState {
    const k = key(resource, level);
    if (this.#edits.has(k)) return { grantees: this.#edits.get(k) ?? null, dirty: true };
    const b = this.#base.get(k);
    return { grantees: b ? [...b] : null, dirty: false };
  }

  saved(resource: string, level: Level): string[] | null {
    const b = this.#base.get(key(resource, level));
    return b ? [...b] : null;
  }

  set(resource: string, level: Level, grantees: readonly string[] | null): void {
    const k = key(resource, level);
    const g = grantees === null ? null : [...new Set(grantees)];
    if (sameSet(g, this.#base.get(k) ?? null)) this.#edits.delete(k);
    else this.#edits.set(k, g);
    this.#emit();
  }

  /** Bật/tắt một người nhận; hàng đang mặc định thì bắt đầu từ tập tương đương mặc định. */
  toggle(resource: string, level: Level, grantee: string, def: Role | undefined): void {
    const cur = this.get(resource, level).grantees ?? defaultGrantees(def);
    this.set(
      resource,
      level,
      cur.includes(grantee) ? cur.filter((x) => x !== grantee) : [...cur, grantee],
    );
  }

  discard(): void {
    this.#edits.clear();
    this.#emit();
  }

  get count(): number {
    return this.#edits.size;
  }

  /** Phần tử `set` của yêu cầu lưu (tối đa 500 mỗi lần theo hợp đồng). */
  changes(): { resource: string; level: Level; grantees: string[] | null }[] {
    return [...this.#edits].map(([k, g]) => {
      const i = k.lastIndexOf('|');
      return { resource: k.slice(0, i), level: k.slice(i + 1) as Level, grantees: g };
    });
  }
}

/** Kế hoạch lưu khi sửa người dùng: thân yêu cầu (chỉ trường đổi) và có cần `reauth` không (hạ vai trò, tắt). */
export function userEditPlan(
  before: AdminUser,
  after: { role: Role; groups: string[]; enabled: boolean; email?: string },
): {
  body: { role?: Role; groups?: string[]; enabled?: boolean; email?: string | null };
  reauth: boolean;
  empty: boolean;
} {
  const body: { role?: Role; groups?: string[]; enabled?: boolean; email?: string | null } = {};
  if (after.role !== before.role) body.role = after.role;
  if (!sameSet(after.groups, before.groups)) body.groups = [...after.groups];
  if (after.enabled !== before.enabled) body.enabled = after.enabled;
  // Feature 023: email của tài khoản (rỗng = xóa); không làm hết phiên.
  if (after.email !== undefined) {
    const e = after.email.trim();
    if (e !== (before.email ?? '')) body.email = e === '' ? null : e;
  }
  const reauth =
    (body.role !== undefined && RANK[body.role] < RANK[before.role]) || body.enabled === false;
  return { body, reauth, empty: Object.keys(body).length === 0 };
}

/** Mã nhóm gợi ý từ tên hiển thị: bỏ dấu, chữ thường, gạch ngang; khớp `^[a-z][a-z0-9-]{1,31}$` hoặc rỗng. */
export function slugify(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return s.length >= 2 ? s : '';
}

export const GROUP_ID = /^[a-z][a-z0-9-]{1,31}$/;
export const USER_NAME = /^[a-z][a-z0-9._-]{2,31}$/;
/** Địa chỉ email như máy chủ nhận (validAccountEmail): ASCII in được, một '@', miền có dấu chấm. */
export const EMAIL = /^[^\s@"<>,;:()[\]\\]+@[^\s@"<>,;:()[\]\\.]+(\.[^\s@"<>,;:()[\]\\.]+)+$/;
export const validEmail = (s: string): boolean =>
  s.length >= 3 && s.length <= 254 && /^[\x21-\x7e]+$/.test(s) && EMAIL.test(s);

export function relativeTime(ms: number | null, now: number): string {
  if (ms === null) return viAdmin.users.never;
  const d = Math.max(0, now - ms);
  if (d < 60_000) return viAdmin.time.now;
  if (d < 3_600_000) return viAdmin.time.minutes(Math.floor(d / 60_000));
  if (d < 86_400_000) return viAdmin.time.hours(Math.floor(d / 3_600_000));
  return viAdmin.time.days(Math.floor(d / 86_400_000));
}

export const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/** Item của một màn hình trong danh mục tài nguyên (thứ tự của project). */
export const itemsOf = (resources: readonly AccessResource[], screen: string): AccessResource[] =>
  resources.filter((r) => r.kind === 'item' && r.screen === screen);

export const itemIdOf = (r: AccessResource): string => r.id.slice(r.id.indexOf('/') + 1);

/** "Thấy" và "thao tác được" của một item theo EffectiveAccess của một người (bảng "ai thấy, ai thao tác"). */
export function effectiveCell(
  e: EffectiveAccess,
  screen: string,
  item: string,
  operable: boolean,
): { sees: boolean; operates: boolean | null } {
  const sees =
    e.admin || (e.screens.includes(screen) && !(e.hiddenItems[screen] ?? []).includes(item));
  if (!operable) return { sees, operates: null };
  return { sees, operates: sees && (e.admin || !(e.lockedItems[screen] ?? []).includes(item)) };
}

/** Tiêu đề hiển thị của một tài nguyên theo mã (quy tắc mồ côi: chính mã). */
export function resourceTitle(resources: readonly AccessResource[], id: string): string {
  const r = resources.find((x) => x.id === id);
  if (!r) return id;
  if (r.kind === 'item' && r.screen) {
    const s = resources.find((x) => x.id === `screen:${r.screen}`);
    return `${s?.title ?? r.screen} › ${r.title}`;
  }
  return r.title;
}
