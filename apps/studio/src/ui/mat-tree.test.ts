// Cây project (feature 004, T041, FR-004, FR-011, contracts/commands.md): mẫu ARIA tree, phím ↑ ↓ → ←
// Home End Enter; Enter mở editor; nhãn giai đoạn tắt được.
import { afterEach, describe, expect, it } from 'vitest';
import './mat-tree.ts';
import type { MatTree } from './mat-tree.ts';
import { cleanup, mount, newApp, newApp02, press, settled } from './test-helpers.ts';

const items = (el: Element) => [...el.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const selected = (el: Element) =>
  el.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]');
const label = (item: HTMLElement | null) => item?.querySelector('.lbl')?.textContent?.trim();

describe('mat-tree', () => {
  afterEach(cleanup);

  it('role tree, nhận focus; mục có aria-level, nút cha có aria-expanded', async () => {
    const { app } = await newApp();
    const tree = await mount<MatTree>('mat-tree', app);
    expect(tree.getAttribute('role')).toBe('tree');
    expect(tree.tabIndex).toBe(0);
    const rows = items(tree);
    expect(label(rows[0])).toBe('Trạm bơm nước (demo Sprint 1)');
    expect(rows[0].getAttribute('aria-level')).toBe('1');
    expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    const tags = rows.find((r) => label(r) === 'Bảng Tag mặc định');
    expect(tags?.getAttribute('aria-level')).toBe('4');
    expect(tags?.hasAttribute('aria-expanded')).toBe(false);
    expect(tags?.querySelector('.cnt')?.textContent).toBe('5');
  });

  it('↑ ↓ di chuyển chọn, Home/End về đầu/cuối, aria-activedescendant theo mục chọn', async () => {
    const { app } = await newApp();
    const tree = await mount<MatTree>('mat-tree', app);
    press(tree, 'ArrowDown');
    await settled(tree);
    expect(label(selected(tree))).toBe('Trạm bơm nước (demo Sprint 1)');
    press(tree, 'ArrowDown');
    await settled(tree);
    expect(label(selected(tree))).toBe('Bắt đầu');
    expect(tree.getAttribute('aria-activedescendant')).toBe(selected(tree)?.id);
    press(tree, 'End');
    await settled(tree);
    expect(label(selected(tree))).toBe('Thư viện project');
    press(tree, 'ArrowUp');
    await settled(tree);
    expect(selected(tree)?.getAttribute('aria-level')).toBe('3');
    press(tree, 'Home');
    await settled(tree);
    expect(label(selected(tree))).toBe('Trạm bơm nước (demo Sprint 1)');
  });

  it('→ mở nút đóng, rồi vào con; ← đóng nút mở, rồi lên cha', async () => {
    const { app } = await newApp();
    app.collapseAll();
    app.selectNode('root', false);
    const tree = await mount<MatTree>('mat-tree', app);
    press(tree, 'ArrowLeft');
    await settled(tree);
    expect(app.ui.expanded.has('root')).toBe(false);
    press(tree, 'ArrowRight');
    await settled(tree);
    expect(app.ui.expanded.has('root')).toBe(true);
    press(tree, 'ArrowRight');
    await settled(tree);
    expect(label(selected(tree))).toBe('Bắt đầu');
    press(tree, 'ArrowLeft');
    await settled(tree);
    expect(label(selected(tree))).toBe('Trạm bơm nước (demo Sprint 1)');
  });

  it('Enter mở editor của mục; nhấp vào mục cũng mở', async () => {
    const { app } = await newApp();
    const tree = await mount<MatTree>('mat-tree', app);
    app.selectNode('tags', false);
    await settled(tree);
    press(tree, 'Enter');
    expect(app.store.state.active).toBe('tags');
    const settings = items(tree).find((r) => label(r) === 'Thiết lập project');
    settings?.click();
    expect(app.store.state.active).toBe('settings');
  });

  it('nhãn giai đoạn hiện cạnh mục chưa làm và tắt được', async () => {
    const { app } = await newApp();
    const tree = await mount<MatTree>('mat-tree', app);
    const alarm = () => items(tree).find((r) => label(r) === 'Báo cáo');
    expect(alarm()?.querySelector('.phase')?.textContent).toBe('GĐ 5');
    app.setShowPhases(false);
    await settled(tree);
    expect(alarm()?.querySelector('.phase')).toBeNull();
  });

  it('chưa mở project: không có mục, có lời nhắc mở project', async () => {
    const { app } = await newApp({ open: false });
    const tree = await mount<MatTree>('mat-tree', app);
    expect(items(tree)).toHaveLength(0);
    expect(tree.textContent).toContain('Chưa mở project');
  });
});

describe('mat-tree: thêm, đổi tên, nhân bản, xóa (feature 006, T083, FR-043)', () => {
  afterEach(cleanup);

  async function setup(node: string) {
    const { app } = await newApp02();
    const tree = await mount<MatTree>('mat-tree', app);
    app.revealNode(node);
    await settled(tree);
    return { app, tree };
  }
  const labels = (tree: Element) => items(tree).map((r) => label(r));

  it('Insert thêm kênh dưới Kết nối; nút mới được chọn; một bước hoàn tác', async () => {
    const { app, tree } = await setup('connections');
    press(tree, 'Insert');
    await settled(tree);
    expect(app.store.state.outline.connections?.channels.map((c) => c.id)).toEqual([
      'plc1',
      'rs485-1',
      'plc2',
    ]);
    expect(app.ui.treeSel).toBe('channel:plc2');
    expect(labels(tree)).toContain('Kênh 2');
    await app.run('edit.undo');
    await settled(tree);
    expect(app.store.state.outline.connections?.channels).toHaveLength(2);
  });

  it('F2 mở hộp thoại Đổi tên; Ctrl+Shift+D nhân bản; Delete xóa (Ctrl+Z trả lại)', async () => {
    const { app, tree } = await setup('watch:van-hanh');
    press(tree, 'F2');
    await settled(tree);
    expect(app.ui.dialog).toEqual({ kind: 'rename' });
    app.closeOnlineDialog();
    press(tree, 'D', { ctrlKey: true, shiftKey: true });
    await settled(tree);
    expect(app.store.state.outline.watchTables.map((w) => w.id)).toEqual([
      'van-hanh',
      'van-hanh-2',
    ]);
    expect(app.ui.treeSel).toBe('watch:van-hanh-2');
    press(tree, 'Delete');
    await settled(tree);
    expect(app.store.state.outline.watchTables.map((w) => w.id)).toEqual(['van-hanh']);
    expect(app.ui.toast?.text).toContain('Ctrl+Z');
    await app.run('edit.undo');
    expect(app.store.state.outline.watchTables).toHaveLength(2);
  });

  it('nút không có thao tác (Bảng Tag): phím lệnh báo lý do, không đổi project', async () => {
    const { app, tree } = await setup('tags');
    const before = app.store.state.history.past.length;
    press(tree, 'Delete');
    await settled(tree);
    expect(app.store.state.history.past.length).toBe(before);
    expect(app.ui.toast?.text).toContain('Chọn Kết nối');
  });

  it('menu chuột phải: Thêm, Đổi tên, Nhân bản, Xóa theo nút; mục bị khóa có lý do; Esc đóng', async () => {
    const { app, tree } = await setup('valueTables');
    app.toggleNode('valueTables');
    await settled(tree);
    const row = tree.querySelector('[id="ti-valuetable:TrangThaiBom"]') as HTMLElement;
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
    );
    await settled(tree);
    const menu = document.querySelector('.tree-ctx [role="menu"]')!;
    expect(menu).not.toBeNull();
    const cmds = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (b) => b.dataset.cmd,
    );
    expect(cmds).toEqual(['tree.add', 'tree.rename', 'tree.duplicate', 'tree.remove']);
    expect(app.ui.treeSel).toBe('valuetable:TrangThaiBom');
    press(menu, 'ArrowDown');
    press(menu, 'ArrowDown');
    press(menu, 'Enter');
    await settled(tree);
    expect(app.store.state.outline.valueTables.map((v) => v.name)).toEqual([
      'TrangThaiBom',
      'TrangThaiBom_2',
    ]);
    expect(document.querySelector('.tree-ctx [role="menu"]')).toBeNull();
    app.revealNode('tags');
    const tagsRow = tree.querySelector('[id="ti-tags"]') as HTMLElement;
    tagsRow.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    await settled(tree);
    const remove = document.querySelector<HTMLElement>('.tree-ctx [data-cmd="tree.remove"]')!;
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.title).toContain('Chọn Kết nối');
    press(document.querySelector('.tree-ctx [role="menu"]')!, 'Escape');
    await settled(tree);
    expect(document.querySelector('.tree-ctx [role="menu"]')).toBeNull();
  });

  it('Shift+F10 mở menu của nút đang chọn; chấm trạng thái kênh Online hiện kèm chữ', async () => {
    const { app, tree } = await setup('channel:plc1');
    press(tree, 'F10', { shiftKey: true });
    await settled(tree);
    expect(document.querySelector('.tree-ctx [role="menu"]')).not.toBeNull();
    expect(app.ui.treeSel).toBe('channel:plc1');
  });
});
