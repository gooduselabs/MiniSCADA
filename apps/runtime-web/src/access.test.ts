// Quyền hiệu lực trên trang (feature 013, access-model §5): đọc thân, câu hỏi quyền, lọc màn hình tự do và lưới.
import type { ScreenModel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { AccessView, emptyForUser, fetchAccess, filterScreen, parseAccess } from './access.ts';
import { fakeFetch } from './testing.ts';

const BODY = {
  user: 'vh1',
  role: 'operator',
  groups: ['ca-a'],
  anonymous: false,
  storeRev: 7,
  usersRev: 12,
  projectHash: 'sha256:x',
  screens: ['tong-quan', 'bom1'],
  hiddenItems: { 'tong-quan': ['chi-phi'] },
  lockedItems: { bom1: ['run'] },
  pages: ['alarms', 'history'],
  admin: false,
};

describe('parseAccess', () => {
  it('đọc đủ khóa', () => {
    expect(parseAccess(BODY)).toEqual(BODY);
  });
  it('sai hình → null; khóa phụ sai kiểu thì bỏ', () => {
    expect(parseAccess(null)).toBeNull();
    expect(parseAccess({ ...BODY, role: 'root' })).toBeNull();
    expect(parseAccess({ ...BODY, screens: 'x' })).toBeNull();
    const a = parseAccess({ ...BODY, hiddenItems: { a: 'x', b: [1, 'y'] }, pages: [1] })!;
    expect(a.hiddenItems).toEqual({ b: ['y'] });
    expect(a.pages).toEqual([]);
  });
});

describe('fetchAccess', () => {
  it('200 → ok; 404 → unsupported; 401 → unauthorized; lỗi mạng → error', async () => {
    const f = fakeFetch({ 'GET /api/v1/web/access': { json: BODY } });
    expect(await fetchAccess(f.fn)).toMatchObject({ status: 'ok' });
    f.set('GET /api/v1/web/access', { status: 404 });
    expect(await fetchAccess(f.fn)).toEqual({ status: 'unsupported' });
    f.set('GET /api/v1/web/access', { status: 401, json: { error: 'AUTH_REQUIRED' } });
    expect(await fetchAccess(f.fn)).toEqual({ status: 'unauthorized' });
    f.set('GET /api/v1/web/access', new Error('x'));
    expect(await fetchAccess(f.fn)).toMatchObject({ status: 'error' });
  });
});

describe('AccessView', () => {
  const v = new AccessView(parseAccess(BODY));
  it('màn hình, trang, ẩn, khóa', () => {
    expect(v.limited).toBe(true);
    expect(v.canView('bom1')).toBe(true);
    expect(v.canView('bao-tri')).toBe(false);
    expect(v.page('alarms')).toBe(true);
    expect(v.page('reports')).toBe(false);
    expect(v.hidden('tong-quan')).toEqual(['chi-phi']);
    expect(v.isLocked('bom1', 'run')).toBe(true);
    expect(v.isLocked('bom1', 'auto')).toBe(false);
  });
  it('null (runtime cũ) và administrator: không giới hạn', () => {
    for (const x of [new AccessView(null), new AccessView(parseAccess({ ...BODY, admin: true }))]) {
      expect(x.limited).toBe(false);
      expect(x.canView('bao-tri')).toBe(true);
      expect(x.page('reports')).toBe(true);
      expect(x.hidden('tong-quan')).toEqual([]);
      expect(x.isLocked('bom1', 'run')).toBe(false);
    }
  });
  it('same: bỏ qua rev, nhận ra đổi màn hình', () => {
    expect(v.same(new AccessView(parseAccess({ ...BODY, storeRev: 9 })))).toBe(true);
    expect(v.same(new AccessView(parseAccess({ ...BODY, screens: ['bom1'] })))).toBe(false);
  });
});

const free = {
  id: 's',
  name: 'S',
  kind: 'screen',
  size: { width: 10, height: 10 },
  items: [
    { id: 'a', type: 'widget', widget: 'card', x: 0, y: 0, width: 1, height: 1 },
    { id: 'b', type: 'widget', widget: 'card', x: 0, y: 0, width: 1, height: 1 },
  ],
} as unknown as ScreenModel;

const grid = {
  ...free,
  layout: {
    mode: 'grid',
    columns: 12,
    rows: [
      {
        id: 'r1',
        height: 'auto',
        cells: [
          { id: 'c1', span: 6, item: 'a' },
          { id: 'c2', span: 6, item: 'b' },
        ],
      },
    ],
  },
} as unknown as ScreenModel;

describe('filterScreen', () => {
  it('không có gì để bỏ: trả chính mô hình', () => {
    expect(filterScreen(free, [])).toBe(free);
    expect(filterScreen(free, ['zz'])).toBe(free);
  });
  it('màn hình tự do: bỏ item', () => {
    const out = filterScreen(free, ['a']);
    expect(out.items.map((i) => i.id)).toEqual(['b']);
    expect(free.items).toHaveLength(2);
  });
  it('lưới: bỏ item và khóa item của ô, ô vẫn còn', () => {
    const out = filterScreen(grid, ['b']) as unknown as {
      items: { id: string }[];
      layout: { rows: { cells: Record<string, unknown>[] }[] };
    };
    expect(out.items.map((i) => i.id)).toEqual(['a']);
    expect(out.layout.rows[0]!.cells).toEqual([
      { id: 'c1', span: 6, item: 'a' },
      { id: 'c2', span: 6 },
    ]);
  });
  it('máy chủ đã bỏ item nhưng ô còn trỏ: vẫn bỏ khóa item của ô', () => {
    const served = { ...grid, items: [free.items[0]] } as unknown as ScreenModel;
    const out = filterScreen(served, ['b']) as unknown as {
      layout: { rows: { cells: Record<string, unknown>[] }[] };
    };
    expect(out.layout.rows[0]!.cells[1]).toEqual({ id: 'c2', span: 6 });
  });
  it('emptyForUser: mọi item bị ẩn', () => {
    expect(emptyForUser(filterScreen(free, ['a', 'b']), ['a', 'b'])).toBe(true);
    expect(emptyForUser(filterScreen(free, ['a']), ['a'])).toBe(false);
    expect(emptyForUser({ ...free, items: [] } as unknown as ScreenModel, [])).toBe(false);
  });
});
