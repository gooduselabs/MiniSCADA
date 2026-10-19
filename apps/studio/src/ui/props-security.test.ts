// Tab Bảo mật của inspector và thuộc tính màn hình (feature 013, T028; contracts/access-model.md §3): ở project 1.1
// mọi item có "Vai trò tối thiểu để xem", item thao tác được có thêm "để thao tác"; ghi `security.view`/`operate` bằng
// một bước hoàn tác; màn hình có "Vai trò tối thiểu để xem" trong hộp Thuộc tính màn hình. Project 1.0 giữ giao diện cũ.
import { resolve } from 'node:path';
import type { Item, ScreenModel } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectDir, REPO } from '../model/test-fixtures.ts';
import './dialogs/screen-props-dialog.ts';
import type { MatScreenPropsDialog } from './dialogs/screen-props-dialog.ts';
import './props-widget.ts';
import type { MatWidgetProps } from './props-widget.ts';
import { cleanup, mount, newApp02, settled } from './test-helpers.ts';

afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function open(vector: string, item: string, patch?: (f: Record<string, string>) => void) {
  const files = readProjectDir(resolve(REPO, 'tests/project-vectors', vector));
  delete files['expected.json'];
  patch?.(files);
  const env = await newApp02({ files });
  env.app.openEditor('screen:main');
  env.app.selectItems('main', [item]);
  const el = await mount<MatWidgetProps>('mat-widget-props', env.app);
  el.screenId = 'main';
  await settled(el);
  env.app.screens.inspTab = 'security';
  el.requestUpdate();
  await settled(el);
  return { ...env, el };
}

const itemOf = (app: Awaited<ReturnType<typeof open>>['app'], id: string) =>
  (app.screenModel('main') as ScreenModel).items.find((i) => i.id === id) as Item & {
    security?: Record<string, string>;
  };
const choose = async (el: Element, sel: string, value: string) => {
  const s = el.querySelector<HTMLSelectElement>(sel)!;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await settled();
};
const tabs = (el: Element) =>
  [...el.querySelectorAll('[role="tab"]')].map((b) => b.id.replace('wi-tab-', ''));

describe('tab Bảo mật (project 1.1)', () => {
  it('nút: hai ô xem và thao tác; chọn là một sửa đổi, hoàn tác được', async () => {
    const { app, el } = await open('v11-valid-full', 'btn_run');
    expect(tabs(el)).toContain('security');
    const text = norm(el.textContent);
    expect(text).toContain('Vai trò tối thiểu để xem');
    expect(text).toContain('Vai trò tối thiểu để thao tác');
    const view = el.querySelector<HTMLSelectElement>('#wi-view')!;
    expect([...view.options].map((o) => o.value)).toEqual([
      'viewer',
      'operator',
      'engineer',
      'administrator',
    ]);
    expect(view.value).toBe('viewer');
    expect(el.querySelector<HTMLSelectElement>('#wi-operate')!.value).toBe('operator');

    await choose(el, '#wi-operate', 'engineer');
    expect(itemOf(app, 'btn_run').security).toEqual({ operate: 'engineer' });
    await choose(el, '#wi-view', 'operator');
    expect(itemOf(app, 'btn_run').security).toEqual({ view: 'operator', operate: 'engineer' });
    app.store.undo();
    expect(itemOf(app, 'btn_run').security).toEqual({ operate: 'engineer' });
    app.store.undo();
    expect(itemOf(app, 'btn_run').security).toBeUndefined();
  });

  it('mức thao tác thấp hơn mức xem không chọn được', async () => {
    const { el } = await open('v11-valid-full', 'btn_run');
    await choose(el, '#wi-view', 'engineer');
    const op = el.querySelector<HTMLSelectElement>('#wi-operate')!;
    const disabled = [...op.options].filter((o) => o.disabled).map((o) => o.value);
    expect(disabled).toEqual(['operator']);
    expect(op.value).toBe('engineer');
  });

  it('setpoint có minRole cũ: hiện như mức thao tác, đổi thì ghi operate thay minRole', async () => {
    const { app, el } = await open('v11-valid-full', 'sp_level');
    expect(el.querySelector<HTMLSelectElement>('#wi-operate')!.value).toBe('engineer');
    await choose(el, '#wi-operate', 'administrator');
    expect(itemOf(app, 'sp_level').security).toEqual({ operate: 'administrator' });
  });

  it('widget hiển thị: chỉ mức xem, có câu giải thích', async () => {
    const { app, el } = await open('v11-valid-full', 'card_level');
    expect(tabs(el)).toContain('security');
    expect(el.querySelector('#wi-operate')).toBeNull();
    expect(norm(el.textContent)).toContain('chỉ hiển thị');
    await choose(el, '#wi-view', 'engineer');
    expect(itemOf(app, 'card_level').security).toEqual({ view: 'engineer' });
  });

  it('item svg: có tab Bảo mật; mức thao tác chỉ khi tệp binding có sự kiện ghi', async () => {
    const a = await open('v11-valid-full', 'svg1');
    expect(tabs(a.el)).toEqual(['general', 'graphics', 'security']);
    expect(a.el.querySelector('#wi-view')).not.toBeNull();
    expect(a.el.querySelector('#wi-operate')).toBeNull();
    cleanup();
    const b = await open('v11-valid-full', 'svg1', (f) => {
      const bind = JSON.parse(f['screens/main.bindings.json']!) as {
        elements: Array<{ elementUid: string; events?: unknown }>;
      };
      bind.elements.find((e) => e.elementUid === 'el_bbb')!.events = {
        click: { action: 'toggle', tag: 'PUMP01.RUN_CMD' },
      };
      f['screens/main.bindings.json'] = JSON.stringify(bind);
    });
    await choose(b.el, '#wi-operate', 'engineer');
    expect(itemOf(b.app, 'svg1').security).toEqual({ operate: 'engineer' });
  });
});

describe('tab Bảo mật (project 1.0): giao diện cũ', () => {
  it('chỉ có vai trò tối thiểu của widget điều khiển, không có mức xem', async () => {
    const { el } = await open('v10-valid-full', 'btn_run');
    expect(el.querySelector('#wi-role')).not.toBeNull();
    expect(el.querySelector('#wi-view')).toBeNull();
    cleanup();
    const card = await open('v10-valid-full', 'card_level');
    expect(tabs(card.el)).not.toContain('security');
  });
});

describe('Thuộc tính màn hình: vai trò tối thiểu để xem', () => {
  async function dialog(vector: string) {
    const files = readProjectDir(resolve(REPO, 'tests/project-vectors', vector));
    delete files['expected.json'];
    const env = await newApp02({ files });
    const el = await mount<MatScreenPropsDialog>('mat-screen-props-dialog', env.app);
    env.app.openDialog({ kind: 'screenProps', id: 'main' });
    await settled();
    return { ...env, el };
  }

  it('project 1.1: chọn vai trò và Áp dụng ghi security.view, hoàn tác được', async () => {
    const { app, el } = await dialog('v11-valid-full');
    expect(norm(el.textContent)).toContain('Vai trò tối thiểu để xem');
    await choose(el, '#spd-view', 'operator');
    el.querySelector<HTMLButtonElement>('[data-role="ok"]')!.click();
    await settled();
    expect((app.screenModel('main') as ScreenModel).security).toEqual({ view: 'operator' });
    app.store.undo();
    expect((app.screenModel('main') as ScreenModel).security).toBeUndefined();
  });

  it('project 1.0: không có ô vai trò', async () => {
    const { el } = await dialog('v10-valid-full');
    expect(el.querySelector('#spd-view')).toBeNull();
  });
});
