// Bộ vector quyền dùng chung (feature 013, T004; contracts/access-model.md §7): mọi ca của tests/access-vectors chạy
// qua computeAccess, so sâu với expected.json (viết tay). Bản C++: core/auth/tests/access_vectors_test.cpp.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeAccess, roleRank } from './compute.ts';
import type { AccessStore, Principal, ResourceCatalog } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/access-vectors');
const cases = readdirSync(DIR).filter((d) => statSync(join(DIR, d)).isDirectory());
const read = <T>(c: string, f: string): T => JSON.parse(readFileSync(join(DIR, c, f), 'utf8')) as T;

const KEYS = [
  'screens',
  'hiddenItems',
  'lockedItems',
  'pages',
  'admin',
  'liveTags',
  'historyTags',
  'alarms',
  'orphans',
] as const;

describe('tests/access-vectors', () => {
  it('đủ ca (≥ 40)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  for (const c of cases)
    it(c, () => {
      const catalog = read<ResourceCatalog>(c, 'catalog.json');
      const store = read<AccessStore>(c, 'access.json');
      const principal = read<Principal>(c, 'principal.json');
      const expected = read<Record<string, unknown>>(c, 'expected.json');
      const got = computeAccess(catalog, store, principal);
      const picked = Object.fromEntries(KEYS.map((k) => [k, got[k]]));
      expect(picked).toEqual(expected);
      expect(got.anonymous).toBe(principal.user === null);
      expect(got.storeRev).toBe(store.rev);
    });
});

describe('computeAccess', () => {
  const catalog: ResourceCatalog = {
    screens: [
      {
        id: 's',
        popup: false,
        view: 'viewer',
        items: [{ id: 'b', operable: true, view: 'viewer', operate: 'operator', tags: ['T'] }],
      },
    ],
    historyGroups: [],
    reports: [],
    alarms: [],
  };
  const store = (rules: AccessStore['rules']): AccessStore => ({
    schemaVersion: '1.0.0',
    rev: 3,
    groups: [],
    rules,
  });

  it('thứ hạng vai trò', () => {
    expect(roleRank('viewer')).toBeLessThan(roleRank('operator'));
    expect(roleRank('operator')).toBeLessThan(roleRank('engineer'));
    expect(roleRank('engineer')).toBeLessThan(roleRank('administrator'));
  });

  it('là hàm thuần: không sửa đầu vào, cùng đầu vào cùng kết quả', () => {
    const s = store([{ resource: 'screen:s', level: 'view', grantees: ['group:g'] }]);
    const p: Principal = { user: 'u', role: 'operator', groups: ['g'] };
    const before = JSON.stringify([catalog, s, p]);
    const a = computeAccess(catalog, s, p);
    const b = computeAccess(catalog, s, p);
    expect(a).toEqual(b);
    expect(JSON.stringify([catalog, s, p])).toBe(before);
  });

  it('id lạ kiểu thuộc tính của Object.prototype không bị nhầm là quy tắc', () => {
    const r = computeAccess(
      catalog,
      store([{ resource: 'screen:constructor', level: 'view', grantees: [] }]),
      { user: 'u', role: 'operator', groups: ['constructor'] },
    );
    expect(r.screens).toEqual(['s']);
    expect(r.orphans).toEqual([{ resource: 'screen:constructor', level: 'view' }]);
  });

  it('vai trò lạ của chủ thể bị coi như không có quyền gì (an toàn mặc định)', () => {
    const r = computeAccess(catalog, store([]), {
      user: 'u',
      role: 'boss' as Principal['role'],
      groups: [],
    });
    expect(r.screens).toEqual([]);
    expect(r.pages).toEqual([]);
    expect(r.liveTags).toEqual([]);
    expect(r.admin).toBe(false);
  });
});
