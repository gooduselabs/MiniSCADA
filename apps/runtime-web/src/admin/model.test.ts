// Logic thuần của trang Quản trị (feature 013): bản nháp quy tắc, kế hoạch sửa người dùng, mã nhóm, ô "ai thấy".
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveAccess } from '../access.ts';
import type { AdminUser } from './api.ts';
import {
  RuleDraft,
  defaultGrantees,
  effectiveCell,
  granteeOptions,
  relativeTime,
  slugify,
  userEditPlan,
} from './model.ts';

describe('RuleDraft', () => {
  it('đọc quy tắc đã lưu; không quy tắc → null (mặc định)', () => {
    const d = new RuleDraft([{ resource: 'screen:a', level: 'view', grantees: ['group:x'] }]);
    expect(d.get('screen:a', 'view')).toEqual({ grantees: ['group:x'], dirty: false });
    expect(d.get('screen:b', 'view')).toEqual({ grantees: null, dirty: false });
  });

  it('toggle trên hàng mặc định bắt đầu từ tập tương đương', () => {
    const d = new RuleDraft();
    d.toggle('screen:b', 'view', 'group:x', 'viewer');
    expect(d.get('screen:b', 'view')).toEqual({ grantees: ['*', 'group:x'], dirty: true });
    d.toggle('item:s/i', 'operate', 'group:y', 'engineer');
    expect(d.get('item:s/i', 'operate').grantees).toEqual(['role:engineer', 'group:y']);
  });

  it('về lại đúng bản đã lưu thì không còn là thay đổi; changes() đúng dạng', () => {
    const d = new RuleDraft([{ resource: 'screen:a', level: 'view', grantees: ['group:x'] }]);
    const fn = vi.fn();
    d.onChange(fn);
    d.toggle('screen:a', 'view', 'group:y', 'viewer');
    expect(d.count).toBe(1);
    d.toggle('screen:a', 'view', 'group:y', 'viewer');
    expect(d.count).toBe(0);
    d.set('screen:a', 'view', null);
    d.set('screen:c', 'view', []);
    expect(d.changes()).toEqual([
      { resource: 'screen:a', level: 'view', grantees: null },
      { resource: 'screen:c', level: 'view', grantees: [] },
    ]);
    expect(fn).toHaveBeenCalled();
    d.discard();
    expect(d.count).toBe(0);
  });

  it('load(keepEdits) bỏ thay đổi đã trùng bản mới', () => {
    const d = new RuleDraft();
    d.set('screen:a', 'view', ['group:x']);
    d.set('screen:b', 'view', ['group:y']);
    d.load([{ resource: 'screen:a', level: 'view', grantees: ['group:x'] }], true);
    expect(d.changes().map((c) => c.resource)).toEqual(['screen:b']);
  });
});

const user = (over: Partial<AdminUser> = {}): AdminUser => ({
  name: 'vh1',
  role: 'operator',
  groups: ['a'],
  enabled: true,
  locked: null,
  lastLoginAt: null,
  createdAt: null,
  updatedAt: null,
  sessions: 0,
  ...over,
});

describe('userEditPlan', () => {
  it('không đổi gì', () => {
    expect(userEditPlan(user(), { role: 'operator', groups: ['a'], enabled: true }).empty).toBe(
      true,
    );
  });
  it('nâng vai trò, đổi nhóm: không cần xác nhận lại', () => {
    const p = userEditPlan(user(), { role: 'engineer', groups: ['b'], enabled: true });
    expect(p).toMatchObject({ body: { role: 'engineer', groups: ['b'] }, reauth: false });
  });
  it('hạ vai trò hoặc tắt: cần xác nhận lại', () => {
    expect(userEditPlan(user(), { role: 'viewer', groups: ['a'], enabled: true }).reauth).toBe(
      true,
    );
    expect(userEditPlan(user(), { role: 'operator', groups: ['a'], enabled: false })).toMatchObject(
      {
        body: { enabled: false },
        reauth: true,
      },
    );
  });
  it('bật lại tài khoản: không cần xác nhận lại', () => {
    expect(
      userEditPlan(user({ enabled: false }), { role: 'operator', groups: ['a'], enabled: true })
        .reauth,
    ).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Vận hành ca A', 'van-hanh-ca-a'],
    ['Đội bảo trì', 'doi-bao-tri'],
    ['  2 Ca  ', 'ca'],
    ['!!', ''],
    ['A'.repeat(40), 'a'.repeat(32)],
  ])('%s → %s', (a, b) => expect(slugify(a)).toBe(b));
});

describe('khác', () => {
  it('defaultGrantees', () => {
    expect(defaultGrantees('viewer')).toEqual(['*']);
    expect(defaultGrantees(undefined)).toEqual(['*']);
    expect(defaultGrantees('operator')).toEqual(['role:operator']);
  });
  it('granteeOptions: *, 3 vai trò, nhóm, người dùng', () => {
    const o = granteeOptions([{ id: 'x', name: 'X', members: [], rules: 0 }], [user()]);
    expect(o.map((x) => x.id)).toEqual([
      '*',
      'role:viewer',
      'role:operator',
      'role:engineer',
      'group:x',
      'user:vh1',
    ]);
  });
  it('relativeTime', () => {
    expect(relativeTime(null, 0)).toBe('chưa đăng nhập');
    expect(relativeTime(0, 30_000)).toBe('vừa xong');
    expect(relativeTime(0, 5 * 60_000)).toBe('5 phút trước');
    expect(relativeTime(0, 3 * 86_400_000)).toBe('3 ngày trước');
  });
  it('effectiveCell', () => {
    const e = {
      admin: false,
      screens: ['s'],
      hiddenItems: { s: ['h'] },
      lockedItems: { s: ['l'] },
    } as unknown as EffectiveAccess;
    expect(effectiveCell(e, 's', 'h', true)).toEqual({ sees: false, operates: false });
    expect(effectiveCell(e, 's', 'l', true)).toEqual({ sees: true, operates: false });
    expect(effectiveCell(e, 's', 'ok', true)).toEqual({ sees: true, operates: true });
    expect(effectiveCell(e, 's', 'ok', false)).toEqual({ sees: true, operates: null });
    expect(effectiveCell(e, 'z', 'ok', false).sees).toBe(false);
  });
});
