// Cây project (feature 004, T041, FR-004, FR-011, contracts/commands.md): mẫu ARIA tree, phím ↑ ↓ → ←
// Home End Enter; Enter mở editor; nhãn giai đoạn tắt được.
import { afterEach, describe, expect, it } from 'vitest';
import './mat-tree.ts';
import type { MatTree } from './mat-tree.ts';
import { cleanup, mount, newApp, press, settled } from './test-helpers.ts';

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
    const alarm = () => items(tree).find((r) => label(r) === 'Alarm');
    expect(alarm()?.querySelector('.phase')?.textContent).toBe('GĐ 4');
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
