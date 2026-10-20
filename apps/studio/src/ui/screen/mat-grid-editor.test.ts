// Trình soạn bố cục lưới (feature 012, T027; US1, FR-016 đến FR-023): lớp phủ theo ô trên <mat-screen mode="edit">, thêm
// hàng theo mẫu cột, thả widget từ Toolbox vào ô (hỏi khi thay), chọn ô, thuộc tính ô và hàng, bàn phím, chiều rộng xem
// trước. Mọi thao tác là một bước hoàn tác qua app.editScreen.
import { resolve } from 'node:path';
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import { readProjectDir } from '../../model/test-fixtures.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { cleanup, press, settled } from '../test-helpers.ts';
import './mat-grid-editor.ts';
import type { MatGridEditor } from './mat-grid-editor.ts';

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
  app.openEditor('screen:tong-quan');
  const el = document.createElement('mat-grid-editor') as MatGridEditor;
  el.app = app;
  el.screenId = 'tong-quan';
  document.body.append(el);
  await settled(el);
  return { app, el };
}

const model = (app: StudioApp) =>
  app.screenModel('tong-quan') as ScreenModel & { layout: GridLayout };
const cellEl = (el: Element, id: string) =>
  el.querySelector<HTMLElement>(`.ge-cell[data-cell="${id}"]`)!;
const spans = (app: StudioApp, r: number) => model(app).layout.rows[r]!.cells.map((c) => c.span);
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** DragEvent của jsdom không có dataTransfer: dựng sự kiện có dataTransfer giả. */
function drag(type: 'dragover' | 'drop', types: string[], data: Record<string, string> = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, 'dataTransfer', {
    value: { types, getData: (k: string) => data[k] ?? '', dropEffect: 'none' },
  });
  return e;
}

describe('mat-grid-editor', () => {
  it('mỗi ô một lớp phủ trong slot của ô; ô trống mời thả component; mat-screen ở chế độ edit', async () => {
    const { el } = await open();
    const cells = [...el.querySelectorAll<HTMLElement>('.ge-cell')];
    expect(cells.map((c) => c.dataset.cell)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(cells.map((c) => c.getAttribute('slot'))).toEqual(
      cells.map((c) => `cell-${c.dataset.cell}`),
    );
    expect(text(cellEl(el, 'c5'))).toContain('Thả component');
    expect(text(cellEl(el, 'c1'))).not.toContain('Thả component');
    expect(cellEl(el, 'c1').getAttribute('aria-label')).toContain('4 cột');
    const screen = el.querySelector('mat-screen') as HTMLElement & { mode: string };
    expect(screen.mode).toBe('edit');
    // đường chia giữa hai ô kề nhau (không có sau ô cuối của hàng)
    expect(cellEl(el, 'c1').querySelector('.ge-divider')).not.toBeNull();
    expect(cellEl(el, 'c3').querySelector('.ge-divider')).toBeNull();
  });

  it('Thêm hàng theo mẫu 6+6: thêm một hàng hai ô ở cuối, một bước hoàn tác', async () => {
    const { app, el } = await open();
    el.querySelector<HTMLButtonElement>('[data-act="add-row"]')!.click();
    await settled(el);
    const presets = [...el.querySelectorAll<HTMLElement>('[data-preset]')].map(
      (b) => b.dataset.preset,
    );
    expect(presets).toEqual(['12', '6+6', '4+4+4', '3+3+3+3', '8+4', '4+8', '3+6+3', 'custom']);
    el.querySelector<HTMLButtonElement>('[data-preset="6+6"]')!.click();
    await settled(el);
    expect(model(app).layout.rows).toHaveLength(4);
    expect(spans(app, 3)).toEqual([6, 6]);
    expect(el.querySelectorAll('.ge-cell')).toHaveLength(8);
    await app.run('edit.undo');
    await settled(el);
    expect(model(app).layout.rows).toHaveLength(3);
  });

  // Feature 014: mẫu hàng có sẵn widget bên cạnh mẫu chia cột.
  it('Thêm hàng → "4 thẻ chỉ số": hàng cao 116 với bốn thẻ màu có tên, chọn ô đầu, một bước hoàn tác', async () => {
    const { app, el } = await open();
    el.querySelector<HTMLButtonElement>('[data-act="add-row"]')!.click();
    await settled(el);
    const tpls = [...el.querySelectorAll<HTMLElement>('[data-template]')].map(
      (b) => b.dataset.template,
    );
    expect(tpls).toEqual(['tiles4', 'charts3', 'charts2plus1', 'wide']);
    expect(text(el.querySelector('[data-template="tiles4"]'))).toContain('4 thẻ chỉ số');
    el.querySelector<HTMLButtonElement>('[data-template="tiles4"]')!.click();
    await settled(el);
    const rows = model(app).layout.rows;
    expect(rows).toHaveLength(4);
    expect(rows[3]!.height).toBe(116);
    const items = rows[3]!.cells.map((c) => model(app).items.find((i) => i.id === c.item)!);
    expect(items.map((i) => (i as unknown as { props: { label: string } }).props.label)).toEqual([
      'Chỉ số 1',
      'Chỉ số 2',
      'Chỉ số 3',
      'Chỉ số 4',
    ]);
    expect(cellEl(el, rows[3]!.cells[0]!.id).classList.contains('sel')).toBe(true);
    await app.run('edit.undo');
    await settled(el);
    expect(model(app).layout.rows).toHaveLength(3);
  });

  it('chọn ô: ô có component chọn luôn item (Inspector); ô trống bỏ chọn item', async () => {
    const { app, el } = await open();
    cellEl(el, 'c1').click();
    await settled(el);
    expect(cellEl(el, 'c1').classList.contains('sel')).toBe(true);
    expect(app.selectedItems('tong-quan')).toEqual(['luu_luong']);
    cellEl(el, 'c5').click();
    await settled(el);
    expect(app.selectedItems('tong-quan')).toEqual([]);
    expect(el.querySelector('[data-field="span"]')).not.toBeNull();
  });

  it('thả widget từ Toolbox vào ô trống: gắn component mới, không có tọa độ, chọn nó', async () => {
    const { app, el } = await open();
    const over = drag('dragover', ['application/x-mat-widget-gauge']);
    cellEl(el, 'c5').dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    await settled(el);
    expect(cellEl(el, 'c5').classList.contains('over')).toBe(true);
    cellEl(el, 'c5').dispatchEvent(drag('drop', ['application/x-mat-widget-gauge']));
    await settled(el);
    const c5 = model(app).layout.rows[1]!.cells[1]!;
    expect(c5.item).toBe('gauge_1');
    expect(model(app).items.find((i) => i.id === 'gauge_1')).toEqual({
      id: 'gauge_1',
      type: 'widget',
      widget: 'gauge',
    });
    expect(app.selectedItems('tong-quan')).toEqual(['gauge_1']);
  });

  it('thả vào ô đã có component: hỏi; Hủy không đổi, Thay thì thay', async () => {
    const { app, el } = await open();
    cellEl(el, 'c3').dispatchEvent(drag('drop', ['application/x-mat-widget-gauge']));
    await settled(el);
    expect(app.ui.dialog).toMatchObject({ kind: 'gridReplace' });
    app.answer('cancel');
    await settled(el);
    expect(model(app).layout.rows[0]!.cells[2]!.item).toBe('den');
    cellEl(el, 'c3').dispatchEvent(drag('drop', ['application/x-mat-widget-gauge']));
    await settled(el);
    app.answer('ok');
    await settled(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(model(app).layout.rows[0]!.cells[2]!.item).toBe('gauge_1');
    expect(model(app).items.some((i) => i.id === 'den')).toBe(false);
  });

  it('chọn ô rồi bấm widget trong Toolbox (attachToSelected) gắn vào ô đó; chưa chọn ô thì báo', async () => {
    const { app, el } = await open();
    el.attachToSelected('lamp');
    expect(app.ui.toast?.text).toContain('Chọn một ô');
    cellEl(el, 'c5').click();
    await settled(el);
    el.attachToSelected('lamp');
    await settled(el);
    expect(model(app).layout.rows[1]!.cells[1]!.item).toBe('lamp_1');
  });

  it('thuộc tính ô: đổi độ rộng; vượt 12 cột thì từ chối, không đổi', async () => {
    const { app, el } = await open();
    cellEl(el, 'c5').click();
    await settled(el);
    const span = el.querySelector<HTMLInputElement>('[data-field="span"]')!;
    span.value = '3';
    span.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(spans(app, 1)).toEqual([8, 3]);
    span.value = '5';
    span.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(spans(app, 1)).toEqual([8, 3]);
    expect(app.ui.toast?.text).toContain('vượt 12 cột');
  });

  it('thuộc tính hàng: chiều cao px và tự động', async () => {
    const { app, el } = await open();
    cellEl(el, 'c1').click();
    await settled(el);
    const auto = el.querySelector<HTMLInputElement>('[data-field="heightAuto"]')!;
    expect(auto.checked).toBe(true);
    auto.checked = false;
    auto.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(model(app).layout.rows[0]!.height).toBe(240);
    const h = el.querySelector<HTMLInputElement>('[data-field="height"]')!;
    h.value = '300';
    h.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(model(app).layout.rows[0]!.height).toBe(300);
  });

  it('bàn phím: Alt+↓ đưa hàng xuống, Ctrl+→ nới ô, ← → chuyển ô, Delete xóa component của ô', async () => {
    const { app, el } = await open();
    cellEl(el, 'c4').focus();
    press(cellEl(el, 'c4'), 'ArrowDown', { altKey: true });
    await settled(el);
    expect(model(app).layout.rows.map((r) => r.id)).toEqual(['r1', 'r3', 'r2']);
    press(cellEl(el, 'c1'), 'ArrowRight', { ctrlKey: true });
    await settled(el);
    expect(spans(app, 0)).toEqual([5, 3, 4]);
    cellEl(el, 'c1').focus();
    press(cellEl(el, 'c1'), 'ArrowRight');
    await settled(el);
    expect(document.activeElement).toBe(cellEl(el, 'c2'));
    press(cellEl(el, 'c2'), 'Delete');
    await settled(el);
    expect(model(app).layout.rows[0]!.cells[1]!.item).toBeUndefined();
    expect(model(app).items.some((i) => i.id === 'dong_ho')).toBe(false);
  });

  it('chiều rộng xem trước 600 px: mat-screen xếp chồng các ô', async () => {
    const { el } = await open();
    el.querySelector<HTMLButtonElement>('[data-width="600"]')!.click();
    await settled(el);
    const screen = el.querySelector('mat-screen') as HTMLElement & {
      viewport: { width: number };
      shadowRoot: ShadowRoot;
    };
    await (screen as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(screen.viewport.width).toBe(600);
    expect(screen.shadowRoot.querySelector('.grid')!.classList.contains('narrow')).toBe(true);
    expect(el.querySelector('[data-width="600"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
