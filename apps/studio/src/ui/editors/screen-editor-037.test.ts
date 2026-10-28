// Feature 037 vòng 2: menu ngữ cảnh "Đổi thành…", sao chép/dán định dạng (Ctrl+Alt+C / Ctrl+Alt+V) trên editor Màn hình.
import { resolve } from 'node:path';
import type { ScreenModel, WidgetItem } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import { readProjectDir } from '../../model/test-fixtures.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { cleanup, settled } from '../test-helpers.ts';
import './screen-editor.ts';
import type { MatScreenEditor } from './screen-editor.ts';

const ROOT = resolve(__dirname, '../../../../..');
afterEach(() => cleanup());

async function open() {
  const files = readProjectDir(resolve(ROOT, 'tests/project-vectors/v11-valid-full'));
  delete files['expected.json'];
  const platform = createMockPlatform();
  platform.control.useProject(files);
  const app = new StudioApp({ platform, storage: null, windowWidth: 1400, versionGate: false });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  app.openEditor('screen:main');
  const el = document.createElement('mat-screen-editor') as MatScreenEditor;
  el.app = app;
  el.screenId = 'main';
  document.body.append(el);
  await settled(el);
  return { app, el };
}
const items = (app: StudioApp) => (app.screenModel('main') as ScreenModel).items as WidgetItem[];

describe('editor Màn hình 037', { timeout: 30_000 }, () => {
  it('Đổi thành…: menu liệt kê loại cùng nhóm; chọn thì đổi tại chỗ, hoàn tác được', async () => {
    const { app, el } = await open();
    const card = items(app).find((i) => i.widget === 'card')!;
    app.selectItems('main', [card.id]);
    el.openMenu(10, 10);
    await settled(el);
    const opt = el.querySelector<HTMLButtonElement>('.se-ctx [data-change="gauge"]');
    expect(opt).not.toBeNull();
    opt!.click();
    await settled(el);
    const after = items(app).find((i) => i.id === card.id)!;
    expect(after.widget).toBe('gauge');
    expect(after.tags).toEqual(card.tags);
    app.store.undo();
    expect(items(app).find((i) => i.id === card.id)!.widget).toBe('card');
  });

  it('Ctrl+Alt+C rồi Ctrl+Alt+V dán định dạng sang component khác, không đổi Tag', async () => {
    const { app, el } = await open();
    const cards = items(app).filter((i) => i.widget === 'card');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const [a, b] = cards as [WidgetItem, WidgetItem];
    app.editScreen('main', (d) => ({
      doc: {
        ...d,
        items: d.items.map((x) =>
          x.id === a.id
            ? ({
                ...x,
                props: { ...(x as WidgetItem).props, fill: 'solid', accent: 'teal' },
              } as never)
            : x,
        ),
      },
    }));
    const key = (k: string) =>
      el
        .querySelector('.se')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: k, ctrlKey: true, altKey: true, bubbles: true }),
        );
    app.selectItems('main', [a.id]);
    key('c');
    app.selectItems('main', [b.id]);
    key('v');
    await settled(el);
    const nb = items(app).find((i) => i.id === b.id)!;
    expect(nb.props).toMatchObject({ fill: 'solid', accent: 'teal' });
    expect(nb.tags).toEqual(b.tags);
  });
});
