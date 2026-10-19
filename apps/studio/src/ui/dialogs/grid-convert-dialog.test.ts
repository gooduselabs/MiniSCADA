// Lệnh "Chuyển sang bố cục lưới" và hộp thoại xem trước (feature 012, T052; US5, FR-040): chỉ bật ở project 1.1 khi màn
// hình đang mở là tự do; hộp thoại hiện số hàng, sơ đồ cột từng hàng, cảnh báo; Áp là MỘT bước hoàn tác (Ctrl+Z về đúng
// bản tự do), Hủy không đổi gì.
import { resolve } from 'node:path';
import type { ScreenModel } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import type { MatGridConvertDialog } from './grid-convert-dialog.ts';
import './grid-convert-dialog.ts';
import '../screen/mat-screen-toolbar.ts';

afterEach(cleanup);

const vector = (name: string) => {
  const f = readProjectDir(resolve(REPO, 'tests/project-vectors', name));
  delete f['expected.json'];
  return f;
};

async function open(name = 'v11-valid-full') {
  const env = await newApp02({ files: vector(name) });
  await env.app.store.validateNow();
  return env;
}

type App = Awaited<ReturnType<typeof open>>['app'];
const model = (app: App, id: string) =>
  app.screenModel(id) as (ScreenModel & { layout?: { rows: unknown[] } }) | null;
const btn = (el: Element, role: 'ok' | 'cancel') =>
  el.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)!;

describe('lệnh screen.convertToGrid', () => {
  it('bật khi màn hình tự do đang mở ở project 1.1; khóa kèm lý do với màn hình lưới và project 1.0', async () => {
    const { app } = await open();
    app.openEditor('screen:main');
    expect(app.enabled('screen.convertToGrid')).toBe(true);
    const grid = app.store.state.outline.screens.find(
      (s) => (s.model as { layout?: unknown } | undefined)?.layout !== undefined,
    );
    expect(grid, 'vector có màn hình lưới').toBeDefined();
    app.openEditor(`screen:${grid!.id}`);
    expect(app.enabled('screen.convertToGrid')).toBe('reason.alreadyGrid');
    app.openEditor('tags');
    expect(app.enabled('screen.convertToGrid')).toBe('reason.screenNotActive');

    const old = await open('v10-valid-full');
    old.app.openEditor('screen:main');
    expect(old.app.enabled('screen.convertToGrid')).toBe('reason.needFormat11');
  });

  it('thanh công cụ của màn hình tự do (project 1.1) có nút Chuyển sang lưới mở hộp thoại', async () => {
    const { app } = await open();
    app.openEditor('screen:main');
    const bar = document.createElement('mat-screen-toolbar');
    bar.app = app;
    bar.screenId = 'main';
    document.body.append(bar);
    await settled();
    const b = bar.querySelector<HTMLButtonElement>('[data-cmd="screen.convertToGrid"]')!;
    expect(b.disabled).toBe(false);
    expect(b.textContent).toContain('Chuyển sang lưới');
    b.click();
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'gridConvert', screen: 'main' });
  });
});

describe('hộp thoại xem trước', () => {
  it('hiện số hàng, sơ đồ cột từng hàng và cảnh báo; Hủy không đổi màn hình', async () => {
    const { app } = await open();
    const el = await mount<MatGridConvertDialog>('mat-grid-convert-dialog', app);
    app.openEditor('screen:main');
    const before = model(app, 'main');
    await app.run('screen.convertToGrid');
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'gridConvert', screen: 'main' });
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const rows = el.querySelectorAll('[data-row]');
    expect(rows.length).toBeGreaterThan(1);
    expect(el.querySelector('[data-k="summary"]')?.textContent).toContain(`${rows.length} hàng`);
    // mỗi item của màn hình có đúng một ô trên sơ đồ
    const cells = [...el.querySelectorAll<HTMLElement>('[data-item]')].map((c) => c.dataset.item);
    expect(cells.sort()).toEqual(before!.items.map((i) => i.id).sort());
    expect(rows[0]!.getAttribute('aria-label')).toMatch(/^Hàng 1: \d+( \+ \d+)*/);
    // `main` có item chồng lấn và dải hơn 12 item: có cảnh báo
    expect(el.querySelectorAll('[data-k="warn"] li').length).toBeGreaterThan(0);
    btn(el, 'cancel').click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(model(app, 'main')).toBe(before);
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('Esc đóng như Hủy', async () => {
    const { app } = await open();
    const el = await mount<MatGridConvertDialog>('mat-grid-convert-dialog', app);
    app.openEditor('screen:main');
    const before = model(app, 'main');
    await app.run('screen.convertToGrid');
    await settled();
    press(el.querySelector('[role="dialog"]')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(model(app, 'main')).toBe(before);
  });

  it('Áp: màn hình thành lưới, giữ mọi item và binding, hợp lệ; Ctrl+Z về đúng bản tự do', async () => {
    const { app } = await open();
    const el = await mount<MatGridConvertDialog>('mat-grid-convert-dialog', app);
    app.openEditor('screen:main');
    const before = model(app, 'main')!;
    const text = JSON.stringify(before);
    await app.run('screen.convertToGrid');
    await settled();
    const n = el.querySelectorAll('[data-row]').length;
    btn(el, 'ok').click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    const after = model(app, 'main')!;
    expect(after.layout?.rows).toHaveLength(n);
    expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(after.items.some((i) => 'x' in i)).toBe(false);
    expect(app.enabled('screen.convertToGrid')).toBe('reason.alreadyGrid');
    await app.store.validateNow();
    expect(app.store.state.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
    await app.run('edit.undo');
    expect(JSON.stringify(model(app, 'main'))).toBe(text);
    expect(app.enabled('screen.convertToGrid')).toBe(true);
  });
});
