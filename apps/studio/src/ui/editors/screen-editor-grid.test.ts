// Editor Màn hình với bố cục lưới (feature 012, T029, T031): màn hình có `layout` mở trình soạn lưới thay cho canvas tự
// do; Toolbox (nhấp đúp hoặc Enter) gắn widget vào ô đang chọn; lệnh chỉ của bố cục tự do (căn lề, phân bố, xếp lớp…)
// báo không dùng được, không đổi tài liệu.
import { resolve } from 'node:path';
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import { readProjectDir } from '../../model/test-fixtures.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './screen-editor.ts';
import type { MatScreenEditor } from './screen-editor.ts';

const ROOT = resolve(__dirname, '../../../../..');

afterEach(() => cleanup());

async function open(screen: string) {
  const files = readProjectDir(resolve(ROOT, 'tests/project-vectors/v11-valid-full'));
  delete files['expected.json'];
  const platform = createMockPlatform();
  platform.control.useProject(files);
  const app = new StudioApp({ platform, storage: null, windowWidth: 1400, versionGate: false });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  app.openEditor(`screen:${screen}`);
  const el = document.createElement('mat-screen-editor') as MatScreenEditor;
  el.app = app;
  el.screenId = screen;
  document.body.append(el);
  await settled(el);
  return { app, el };
}
const model = (app: StudioApp) =>
  app.screenModel('tong-quan') as ScreenModel & { layout: GridLayout };

describe('mat-screen-editor: bố cục lưới', () => {
  // Ca đầu nạp lạnh trình soạn và mat-screen (vài trăm KB mã): chậm khi nhiều worker chạy song song, hạn 30 s.
  it(
    'màn hình lưới mở trình soạn lưới, màn hình tự do vẫn mở canvas',
    { timeout: 30_000 },
    async () => {
      const grid = await open('tong-quan');
      expect(grid.el.querySelector('mat-grid-editor')).not.toBeNull();
      expect(grid.el.querySelector('mat-screen-canvas')).toBeNull();
      // feature 029: một giao diện, không đặt data-mat-theme theo project
      expect(document.documentElement.dataset.matTheme).toBeUndefined();
      cleanup();
      const free = await open('main');
      expect(free.el.querySelector('mat-screen-canvas')).not.toBeNull();
      expect(free.el.querySelector('mat-grid-editor')).toBeNull();
    },
  );

  it('Toolbox gắn widget vào ô đang chọn', async () => {
    const { app, el } = await open('tong-quan');
    el.querySelector<HTMLElement>('.ge-cell[data-cell="c5"]')!.click();
    await settled(el);
    app.hooks.addWidget?.('lamp');
    await settled(el);
    expect(model(app).layout.rows[1]!.cells[1]!.item).toBe('lamp_1');
  });

  it('lệnh chỉ của bố cục tự do: báo, không đổi tài liệu', async () => {
    const { app, el } = await open('tong-quan');
    const before = model(app);
    // feature 035: dán, nhân bản, zoom đã có ở trình soạn lưới; căn lề vẫn chỉ của bố cục tự do
    el.exec('screen.zoomIn');
    el.exec('screen.alignLeft');
    expect(app.ui.toast?.text).toContain('bố cục tự do');
    expect(model(app)).toBe(before);
  });
});

describe('Inspector của component trên màn hình lưới (FR-020)', () => {
  it('không có ô X, Y, Rộng, Cao; màn hình tự do vẫn có', async () => {
    await import('../props-widget.ts');
    const { app } = await open('tong-quan');
    app.selectItems('tong-quan', ['luu_luong']);
    const props = document.createElement('mat-widget-props') as HTMLElement & {
      app: StudioApp;
      screenId: string;
    };
    props.app = app;
    props.screenId = 'tong-quan';
    document.body.append(props);
    await settled(props);
    expect(props.querySelector('[data-field="rect"]')).toBeNull();
    app.selectItems('main', [app.screenModel('main')!.items[0]!.id]);
    props.screenId = 'main';
    await settled(props);
    expect(props.querySelector('[data-field="rect"]')).not.toBeNull();
  });
});
