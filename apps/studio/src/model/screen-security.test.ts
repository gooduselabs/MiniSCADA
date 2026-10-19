// Vai trò tối thiểu của item và màn hình (feature 013, T028; contracts/access-model.md §3, tests/project-vectors
// README-013.md): thao tác thuần setItemAccess, setScreenProps({ view }).
import type { Item, ScreenModel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { setItemAccess, setScreenProps } from './screen-doc.ts';

const doc = (): ScreenModel =>
  ({
    schemaVersion: '1.1.0',
    id: 's',
    name: 'S',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    items: [
      { id: 'b', type: 'widget', widget: 'button', x: 0, y: 0, width: 120, height: 40 },
      {
        id: 'sp',
        type: 'widget',
        widget: 'setpoint',
        x: 0,
        y: 50,
        width: 160,
        height: 60,
        security: { minRole: 'engineer' },
      },
      { id: 'c', type: 'widget', widget: 'card', x: 0, y: 120, width: 160, height: 60 },
      {
        id: 'g',
        type: 'svg',
        x: 0,
        y: 200,
        width: 100,
        height: 100,
        svgFile: 'screens/g.svg',
        bindingFile: 'screens/g.bindings.json',
        viewBox: [0, 0, 100, 100],
        elements: [],
      },
    ],
  }) as unknown as ScreenModel;
const sec = (d: ScreenModel, id: string) =>
  (d.items.find((i) => i.id === id) as Item & { security?: Record<string, string> }).security;

describe('setItemAccess', () => {
  it('đặt view, operate cho nút; mặc định (viewer, operator) thì bỏ khóa', () => {
    let r = setItemAccess(doc(), 'b', { view: 'operator', operate: 'engineer' });
    expect(r.rejected).toBeUndefined();
    expect(sec(r.doc, 'b')).toEqual({ view: 'operator', operate: 'engineer' });
    r = setItemAccess(r.doc, 'b', { view: 'viewer', operate: 'operator' });
    expect(sec(r.doc, 'b')).toBeUndefined();
  });

  it('operate thay minRole (bí danh cũ), không để hai giá trị khác nhau', () => {
    const r = setItemAccess(doc(), 'sp', { operate: 'administrator' });
    expect(sec(r.doc, 'sp')).toEqual({ operate: 'administrator' });
  });

  it('view của widget hiển thị được; operate thì bị từ chối (E_SECURITY_ITEM)', () => {
    expect(sec(setItemAccess(doc(), 'c', { view: 'engineer' }).doc, 'c')).toEqual({
      view: 'engineer',
    });
    const r = setItemAccess(doc(), 'c', { operate: 'engineer' });
    expect(r.rejected).toBe('bad-security');
    expect(r.doc).toEqual(doc());
  });

  it('item svg: operate chỉ khi bên gọi báo có sự kiện ghi', () => {
    expect(setItemAccess(doc(), 'g', { operate: 'engineer' }).rejected).toBe('bad-security');
    const r = setItemAccess(doc(), 'g', { operate: 'engineer' }, { svgOperable: true });
    expect(sec(r.doc, 'g')).toEqual({ operate: 'engineer' });
  });

  it('operate viewer hoặc thấp hơn view bị từ chối; nâng view kéo operate đã khai lên theo', () => {
    expect(setItemAccess(doc(), 'b', { operate: 'viewer' }).rejected).toBe('bad-security');
    expect(setItemAccess(doc(), 'b', { view: 'engineer', operate: 'operator' }).rejected).toBe(
      'bad-security',
    );
    const r1 = setItemAccess(doc(), 'b', { operate: 'engineer' });
    const r2 = setItemAccess(r1.doc, 'b', { view: 'administrator' });
    expect(sec(r2.doc, 'b')).toEqual({ view: 'administrator', operate: 'administrator' });
    // minRole cũ cũng được nâng (thành operate)
    const r3 = setItemAccess(doc(), 'sp', { view: 'administrator' });
    expect(sec(r3.doc, 'sp')).toEqual({ view: 'administrator', operate: 'administrator' });
  });

  it('null bỏ khóa; không đổi gì thì trả đúng doc cũ', () => {
    const d = setItemAccess(doc(), 'b', { view: 'engineer' }).doc;
    expect(sec(setItemAccess(d, 'b', { view: null }).doc, 'b')).toBeUndefined();
    expect(setItemAccess(d, 'b', { view: 'engineer' }).doc).toBe(d);
    expect(setItemAccess(doc(), 'x', { view: 'engineer' }).rejected).toBe('unknown-item');
  });
});

describe('setScreenProps: vai trò tối thiểu để xem', () => {
  it('đặt và bỏ security.view của màn hình', () => {
    const r = setScreenProps(doc(), { view: 'engineer' });
    expect(r.doc.security).toEqual({ view: 'engineer' });
    expect(setScreenProps(r.doc, { view: null }).doc.security).toBeUndefined();
    expect(setScreenProps(r.doc, { view: 'viewer' }).doc.security).toBeUndefined();
    expect(setScreenProps(doc(), { view: 'boss' as 'viewer' }).rejected).toBe('bad-screen-prop');
  });
});
