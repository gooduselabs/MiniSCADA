// T087/T103: mục menu của trang lịch sử và báo cáo (feature 010): `navigation[].report`, tự thêm báo cáo khi không có
// `navigation`; feature 030: mục "Lịch sử" chỉ khi navigation khai báo `system: history` (lưu trữ bật, có phiên),
// khóa `@history`, `@report/<id>`.
import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuEntry } from './menu.ts';
import type { ScreenSummary } from './project-store.ts';

const scr = (id: string, kind: 'screen' | 'popup' = 'screen'): ScreenSummary => ({
  id,
  name: id.toUpperCase(),
  kind,
});
const SCREENS = [scr('a'), scr('b'), scr('pop', 'popup')];
const REPORTS = [
  { id: 'dien-ngay', name: 'Điện năng theo ngày' },
  { id: 'dien-ca', name: 'Điện năng theo ca' },
];

const keys = (entries: MenuEntry[]): string[] =>
  entries.flatMap((e) => (e.kind === 'item' ? [e.screen] : e.items.map((i) => i.screen)));

describe('buildMenu với báo cáo và lịch sử', () => {
  it('không có navigation: màn hình, rồi mỗi mẫu báo cáo; không tự thêm Lịch sử', () => {
    const m = buildMenu(null, SCREENS, { reports: REPORTS, history: true })!;
    expect(keys(m.entries)).toEqual(['a', 'b', '@report/dien-ngay', '@report/dien-ca']);
    const rep = m.entries[2]!;
    expect(rep).toMatchObject({ kind: 'item', label: 'Điện năng theo ngày', icon: 'doc' });
  });

  it('có navigation: mục báo cáo theo navigation, không tự thêm mẫu khác; Lịch sử theo mục system', () => {
    const m = buildMenu(
      {
        position: 'left',
        items: [
          { label: 'A', screen: 'a' },
          { label: 'Báo cáo điện', report: 'dien-ca', icon: 'bolt' },
          { label: 'Lịch sử', system: 'history' },
        ],
      } as never,
      SCREENS,
      { reports: REPORTS, history: true },
    )!;
    expect(keys(m.entries)).toEqual(['a', '@report/dien-ca', '@history']);
    expect(m.entries[2]).toMatchObject({ label: 'Lịch sử', icon: 'chart', system: true });
    expect(m.entries[1]).toEqual({
      kind: 'item',
      label: 'Báo cáo điện',
      screen: '@report/dien-ca',
      icon: 'bolt',
    });
  });

  it('mục báo cáo trỏ mẫu không có bị bỏ; nằm trong nhóm được', () => {
    const m = buildMenu(
      {
        position: 'left',
        items: [
          { label: 'A', screen: 'a' },
          {
            label: 'Báo cáo',
            items: [
              { label: 'Có', report: 'dien-ngay' },
              { label: 'Không', report: 'khong-co' },
            ],
          },
        ],
      } as never,
      SCREENS,
      { reports: REPORTS },
    )!;
    expect(keys(m.entries)).toEqual(['a', '@report/dien-ngay']);
  });

  it('một màn hình nhưng có báo cáo: vẫn có menu; Lịch sử không tự thêm', () => {
    expect(buildMenu(null, [scr('a')], { reports: REPORTS })).not.toBeNull();
    expect(buildMenu(null, [scr('a')], { history: true })).toBeNull();
    expect(buildMenu(null, [scr('a')])).toBeNull();
  });

  it('position hidden: không menu dù có báo cáo', () => {
    expect(
      buildMenu({ position: 'hidden', items: [] } as never, SCREENS, { reports: REPORTS }),
    ).toBeNull();
  });

  it('mục system: history bị bỏ khi history=false hoặc không truyền', () => {
    const nav = {
      position: 'left',
      items: [
        { label: 'A', screen: 'a' },
        { label: 'B', screen: 'b' },
        { label: 'Lịch sử', system: 'history' },
      ],
    } as never;
    expect(keys(buildMenu(nav, SCREENS, { history: false })!.entries)).toEqual(['a', 'b']);
    expect(keys(buildMenu(nav, SCREENS)!.entries)).toEqual(['a', 'b']);
  });

  it('tên mẫu chứa mã HTML vẫn là chữ thuần (không phần tử, kiểm ở mô hình)', () => {
    const m = buildMenu(null, SCREENS, {
      reports: [{ id: 'x', name: '<script>alert(1)</script>' }],
    })!;
    expect(m.entries[2]).toMatchObject({ label: '<script>alert(1)</script>' });
  });
});
