// Feature 030: menu của trang vận hành 100 % theo cấu hình. Mô hình: thêm lá `system` (mỗi trang một lần), chuông cảnh báo
// (`navigation.alarmBell`); giao diện: nhóm "Trang hệ thống" của editor Điều hướng, cảnh báo khi project thiếu tính năng
// (W_NAV_SYSTEM), ô "Chuông cảnh báo", khóa ở project dưới 1.1.
import type { Navigation } from '@mat/project-schema';
import { render } from 'lit';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSystemLeaf,
  setAlarmBell,
  setScreenAt,
  usesSystem,
  type ScreenRef,
} from '../../model/navigation-doc.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { newHistoryApp } from '../history-test-helpers.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './navigation-editor.ts';

afterEach(cleanup);

const nav0 = (): Navigation => ({
  position: 'left',
  items: [{ label: 'Tổng quan', screen: 'tong-quan' }],
});
const SCREENS: ScreenRef[] = [{ id: 'tong-quan', kind: 'screen' }];

describe('mô hình: trang hệ thống và chuông cảnh báo', () => {
  it('addSystemLeaf thêm lá `system` (không screen/report); trùng, id lạ, nhãn rỗng bị từ chối', () => {
    const r = addSystemLeaf(nav0(), { label: 'Cảnh báo', system: 'alarms' });
    expect(r.rejected).toBeUndefined();
    expect(r.nav.items[1]).toEqual({ label: 'Cảnh báo', system: 'alarms' });
    expect(usesSystem(r.nav, 'alarms')).toBe(true);
    expect(addSystemLeaf(r.nav, { label: 'Lần hai', system: 'alarms' }).rejected).toBe(
      'dup-system',
    );
    expect(addSystemLeaf(nav0(), { label: 'X', system: 'trends' as never }).rejected).toBe(
      'bad-system',
    );
    expect(addSystemLeaf(nav0(), { label: ' ', system: 'admin' }).rejected).toBe('bad-label');
  });

  it('lá hệ thống vào nhóm được; đổi sang màn hình thì bỏ `system`', () => {
    const g: Navigation = { items: [{ label: 'G', items: [{ label: 'A', screen: 'tong-quan' }] }] };
    const r = addSystemLeaf(g, { label: 'Quản trị', system: 'admin' }, { parent: [0] });
    expect(r.nav.items[0]!.items![1]).toEqual({ label: 'Quản trị', system: 'admin' });
    const s = setScreenAt(r.nav, [0, 1], 'tong-quan', SCREENS);
    expect(s.nav.items[0]!.items![1]).toEqual({ label: 'Quản trị', screen: 'tong-quan' });
  });

  it('setAlarmBell: tắt ghi false, bật bỏ khóa (mặc định); không đổi thì trả nav cũ', () => {
    const off = setAlarmBell(nav0(), false).nav;
    expect(off.alarmBell).toBe(false);
    const on = setAlarmBell(off, true).nav;
    expect('alarmBell' in on).toBe(false);
    const n = nav0();
    expect(setAlarmBell(n, true).nav).toBe(n);
  });
});

describe('editor Điều hướng: nhóm Trang hệ thống', () => {
  async function open(project: string) {
    const files = readProjectDir(resolve(REPO, `projects/${project}`));
    const { app } = await newHistoryApp({ files });
    const host = document.createElement('div');
    document.body.append(host);
    app.openEditor('navigation');
    render(renderEditor(app, 'navigation'), host);
    await settled(host);
    return { app, host };
  }
  const nav = (app: Awaited<ReturnType<typeof open>>['app']) => app.store.state.outline.navigation!;
  const sysRow = (host: Element, id: string) =>
    host.querySelector<HTMLElement>(`.ne-sys-row[data-system="${id}"]`)!;
  const addBtn = (host: Element, id: string) =>
    host.querySelector<HTMLButtonElement>(`[data-act="add-system"][data-system="${id}"]`)!;

  it('đủ năm trang; trang đã có trong menu thì nút thêm khóa; thiếu tính năng thì dòng cảnh báo', async () => {
    const { host } = await open('grid-demo');
    const ids = [...host.querySelectorAll<HTMLElement>('.ne-sys-row')].map((r) => r.dataset.system);
    expect(ids).toEqual(['alarms', 'alarm-history', 'history', 'recipes', 'admin']);
    expect(addBtn(host, 'admin').disabled).toBe(true);
    expect(sysRow(host, 'admin').textContent).toContain('Đã có trong menu');
    expect(sysRow(host, 'alarms').classList.contains('warn')).toBe(true);
    expect(sysRow(host, 'alarms').textContent).toContain('chưa có alarm');
    expect(addBtn(host, 'alarms').getAttribute('aria-label')).toBe('Thêm Alarm vào menu');
  });

  it('thêm Alarm: lá `system` cuối menu, được chọn, một bước hoàn tác; kiểm tra báo W_NAV_SYSTEM', async () => {
    const { app, host } = await open('grid-demo');
    const before = nav(app).items.length;
    addBtn(host, 'alarms').click();
    await settled(host);
    const last = nav(app).items.at(-1)!;
    expect(last).toEqual({ label: 'Alarm', system: 'alarms' });
    expect(host.querySelector('#ne-system')?.textContent).toContain('Alarm');
    expect(host.querySelector('.ne-row.sel')?.classList.contains('warn')).toBe(true);
    await app.run('tools.validate');
    expect(app.store.state.issues.some((i) => i.code === 'W_NAV_SYSTEM')).toBe(true);
    app.store.undo();
    expect(nav(app).items.length).toBe(before);
  });

  it('ô Chuông cảnh báo: bỏ chọn ghi alarmBell = false; chọn lại bỏ khóa', async () => {
    const { app, host } = await open('report-demo');
    const box = host.querySelector<HTMLInputElement>('#ne-bell')!;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(host);
    expect(nav(app).alarmBell).toBe(false);
    const box2 = host.querySelector<HTMLInputElement>('#ne-bell')!;
    box2.checked = true;
    box2.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(host);
    expect('alarmBell' in nav(app)).toBe(false);
  });

  it('project dưới 1.1: nút thêm trang hệ thống và ô chuông khóa, có lời nhắc nâng cấp', async () => {
    const { host } = await open('history-demo');
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-act="add-system"]'))
      expect(b.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#ne-bell')!.disabled).toBe(true);
    expect(host.querySelector('.ne-sys-help')?.textContent).toContain('định dạng 1.1');
  });
});
