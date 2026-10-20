// Bộ tính quyền hiệu lực (feature 013, T005; contracts/access-model.md §4; quy ước ở tests/access-vectors/README.md).
// Hàm thuần: cùng (danh mục, kho, chủ thể) cùng kết quả, không sửa đầu vào. Bản C++ phải cài giống hệt:
// core/auth/access_model.cpp, cùng vector tests/access-vectors.
import {
  ROLES,
  SYSTEM_PAGES,
  type AccessLevel,
  type AccessRule,
  type AccessStore,
  type EffectiveAccess,
  type OrphanRule,
  type Principal,
  type ResourceCatalog,
  type Role,
  type SystemPage,
} from './types.ts';

/** Thứ hạng vai trò (0 đến 3); vai trò lạ là -1 (dưới mọi sàn). */
export function roleRank(role: string): number {
  return (ROLES as readonly string[]).indexOf(role);
}

const ADMIN_RANK = roleRank('administrator');
/** Sàn của mức (§4 `floor`): viewer cho view, operator cho operate. */
const FLOOR: Record<AccessLevel, number> = {
  view: roleRank('viewer'),
  operate: roleRank('operator'),
};

/** Mặc định project của trang hệ thống (§3): `page:watch` là operator, còn lại viewer. */
const PAGE_DEFAULT: Record<SystemPage, Role> = {
  alarms: 'viewer',
  history: 'viewer',
  reports: 'viewer',
  watch: 'operator',
};

const sorted = (xs: Iterable<string>): string[] =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const ruleKey = (resource: string, level: AccessLevel) => `${level} ${resource}`;

/** `match(P, g)` của §4. */
function matches(p: Principal, g: string): boolean {
  if (g === '*') return p.user !== null;
  if (g.startsWith('user:')) return p.user !== null && p.user === g.slice(5);
  if (g.startsWith('group:')) return p.groups.includes(g.slice(6));
  if (g.startsWith('role:')) {
    const r = roleRank(g.slice(5));
    return r >= 0 && roleRank(p.role) >= r;
  }
  return false;
}

export function computeAccess(
  catalog: ResourceCatalog,
  store: AccessStore,
  principal: Principal,
): EffectiveAccess {
  const rank = roleRank(principal.role);
  const admin = rank === ADMIN_RANK;

  // Tài nguyên áp được của danh mục: khóa (mức, mã) -> mặc định project. Quy tắc ngoài tập này là mồ côi (README mục 5).
  const defaults = new Map<string, Role>();
  for (const s of catalog.screens) {
    defaults.set(ruleKey(`screen:${s.id}`, 'view'), s.view);
    for (const it of s.items) {
      const res = `item:${s.id}/${it.id}`;
      defaults.set(ruleKey(res, 'view'), it.view);
      if (it.operable) defaults.set(ruleKey(res, 'operate'), it.operate ?? 'operator');
    }
  }
  for (const g of catalog.historyGroups) defaults.set(ruleKey(`history:${g.id}`, 'view'), 'viewer');
  for (const r of catalog.reports) defaults.set(ruleKey(`report:${r.id}`, 'view'), 'viewer');
  for (const pg of SYSTEM_PAGES) defaults.set(ruleKey(`page:${pg}`, 'view'), PAGE_DEFAULT[pg]);

  const rules = new Map<string, AccessRule>();
  const orphans: OrphanRule[] = [];
  for (const r of store.rules) {
    const k = ruleKey(r.resource, r.level);
    if (defaults.has(k)) rules.set(k, r);
    else orphans.push({ resource: r.resource, level: r.level });
  }
  orphans.sort((a, b) =>
    a.resource !== b.resource ? (a.resource < b.resource ? -1 : 1) : a.level < b.level ? -1 : 1,
  );

  /** `allowed(P, res, level)` của §4 (không gồm điều kiện cha). */
  const allowed = (resource: string, level: AccessLevel): boolean => {
    if (admin) return true;
    const k = ruleKey(resource, level);
    const def = defaults.get(k);
    if (def === undefined || rank < FLOOR[level] || rank < roleRank(def)) return false;
    const rule = rules.get(k);
    return rule === undefined || rule.grantees.some((g) => matches(principal, g));
  };

  const screens: string[] = [];
  const hiddenItems: Record<string, string[]> = {};
  const lockedItems: Record<string, string[]> = {};
  const live = new Set<string>();
  for (const s of catalog.screens) {
    if (!allowed(`screen:${s.id}`, 'view')) continue;
    screens.push(s.id);
    const hidden: string[] = [];
    const locked: string[] = [];
    for (const it of s.items) {
      const res = `item:${s.id}/${it.id}`;
      if (!allowed(res, 'view')) {
        hidden.push(it.id);
        continue;
      }
      for (const t of it.tags) live.add(t);
      if (it.operable && !allowed(res, 'operate')) locked.push(it.id);
    }
    if (hidden.length) hiddenItems[s.id] = sorted(hidden);
    if (locked.length) lockedItems[s.id] = sorted(locked);
  }

  const pages = SYSTEM_PAGES.filter((pg) => allowed(`page:${pg}`, 'view'));
  const history = new Set(live);
  if (pages.includes('history'))
    for (const g of catalog.historyGroups)
      if (allowed(`history:${g.id}`, 'view')) for (const t of g.tags) history.add(t);
  if (pages.includes('reports'))
    for (const r of catalog.reports)
      if (allowed(`report:${r.id}`, 'view')) for (const t of r.tags) history.add(t);

  const alarms = admin
    ? catalog.alarms.map((a) => a.id)
    : catalog.alarms
        .filter((a) => (a.tag === null ? pages.includes('alarms') : live.has(a.tag)))
        .map((a) => a.id);

  return {
    user: principal.user,
    role: principal.role,
    groups: sorted(principal.groups),
    anonymous: principal.user === null,
    storeRev: store.rev,
    screens,
    hiddenItems,
    lockedItems,
    pages: [...pages].sort(),
    admin,
    liveTags: sorted(live),
    historyTags: sorted(history),
    alarms: sorted(alarms),
    orphans,
  };
}
