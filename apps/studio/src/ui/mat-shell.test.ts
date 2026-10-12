// Khung bảy vùng (feature 004, T041, FR-001, FR-002, FR-011): đủ vùng; kéo thanh đổi cỡ cập nhật không
// gian làm việc; F6/Shift+F6 chuyển vùng; thu gọn task card; viền cam khi làm việc với thiết bị.
import { afterEach, describe, expect, it, vi } from 'vitest';
import './mat-shell.ts';
import type { MatShell } from './mat-shell.ts';
import { cleanup, mount, newApp, press, settled } from './test-helpers.ts';

const region = (el: Element, name: string) =>
  el.querySelector<HTMLElement>(`[data-region="${name}"]`);

function drag(handle: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  const ev = (type: string, p: { x: number; y: number }) =>
    new MouseEvent(type, {
      clientX: p.x,
      clientY: p.y,
      bubbles: true,
      cancelable: true,
      button: 0,
    });
  handle.dispatchEvent(ev('pointerdown', from));
  handle.dispatchEvent(ev('pointermove', to));
  handle.dispatchEvent(ev('pointerup', to));
}

describe('mat-shell', () => {
  afterEach(cleanup);

  it('đủ bảy vùng và các vai trò ARIA chính', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    await settled(el);
    expect(el.querySelector('[role="menubar"]')).not.toBeNull();
    expect(el.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(el.querySelector('[role="tree"]')).not.toBeNull();
    expect(region(el, 'details')).not.toBeNull();
    expect(el.querySelector('[role="tablist"][aria-label="Editor đang mở"]')).not.toBeNull();
    expect(el.querySelector('#editor-panel[role="tabpanel"]')).not.toBeNull();
    expect(el.querySelector('[role="tablist"][aria-label="Inspector"]')).not.toBeNull();
    expect(el.querySelector('[role="tablist"][aria-label="Task card"]')).not.toBeNull();
    expect(region(el, 'statusbar')).not.toBeNull();
  });

  it('kéo thanh dọc đổi độ rộng cây (kẹp 180–480), phím mũi tên trên thanh cũng đổi', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    const split = el.querySelector<HTMLElement>('[data-split="left"]')!;
    drag(split, { x: 264, y: 300 }, { x: 330, y: 300 });
    expect(app.workspace.leftWidth).toBe(330);
    drag(split, { x: 330, y: 300 }, { x: 900, y: 300 });
    expect(app.workspace.leftWidth).toBe(480);
    press(split, 'ArrowLeft');
    expect(app.workspace.leftWidth).toBe(464);
    await settled(el);
    expect(el.querySelector<HTMLElement>('.win')?.style.getPropertyValue('--left-w')).toBe('464px');
    expect(split.getAttribute('aria-valuenow')).toBe('464');
  });

  it('kéo thanh ngang của inspector đổi chiều cao inspector', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    const split = el.querySelector<HTMLElement>('[data-split="inspector"]')!;
    press(split, 'ArrowUp');
    expect(app.workspace.inspectorHeight).toBe(218 + 16);
  });

  it('F6 / Shift+F6 chuyển focus qua các vùng theo vòng', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    await settled(el);
    const order = ['tree', 'details', 'editor', 'inspector', 'taskcards', 'statusbar'];
    region(el, 'tree')?.focus();
    for (const name of [...order.slice(1), 'tree']) {
      await app.run('view.nextRegion');
      expect(region(el, name)?.contains(document.activeElement), name).toBe(true);
    }
    await app.run('view.prevRegion');
    expect(region(el, 'statusbar')?.contains(document.activeElement)).toBe(true);
  });

  it('thu gọn task card bằng nút trên dải tab dọc', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    await settled(el);
    expect(el.querySelector('.tc-panel')).not.toBeNull();
    el.querySelector<HTMLElement>('[role="tab"][data-tc="toolbox"]')?.click();
    await settled(el);
    expect(app.workspace.taskCardOpen).toBe(false);
    expect(el.querySelector('.tc-panel')).toBeNull();
  });

  it('làm việc với thiết bị: khung có viền cam (lớp online)', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    expect(el.querySelector('.win')?.classList.contains('online')).toBe(false);
    vi.spyOn(app, 'online').mockReturnValue(true);
    app.setInspectorTab('info');
    await settled(el);
    expect(el.querySelector('.win')?.classList.contains('online')).toBe(true);
  });

  it('editor đang mở hiện trong vùng editor', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    app.openEditor('phase:alarm');
    await settled(el);
    expect(el.querySelector('#editor-panel')?.textContent).toContain('Alarm có ở GĐ 4');
  });
});
