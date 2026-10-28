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

  it('kéo thanh ngang của inspector đổi chiều cao inspector (editor dạng bảng)', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    const split = el.querySelector<HTMLElement>('[data-split="inspector"]')!;
    press(split, 'ArrowUp');
    expect(app.workspace.inspectorHeight).toBe(218 + 16);
  });

  it('editor canvas: khung Thuộc tính nằm dọc bên phải: kéo thanh dọc đổi độ rộng (kẹp 280–720), mũi tên trái rộng ra', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    await settled(el);
    expect(el.querySelector('.center')?.classList.contains('side')).toBe(false);
    app.openEditor('screen:main');
    await settled(el);
    expect(el.querySelector('.center')?.classList.contains('side')).toBe(true);
    expect(el.querySelector('[data-split="inspector"]')).toBeNull();
    const split = el.querySelector<HTMLElement>('[data-split="side"]')!;
    press(split, 'ArrowLeft');
    expect(app.workspace.inspectorWidth).toBe(400 + 16);
    press(split, 'ArrowRight');
    expect(app.workspace.inspectorWidth).toBe(400);
    app.setLayout({ inspectorWidth: 5000 });
    expect(app.workspace.inspectorWidth).toBe(720);
    app.setLayout({ inspectorWidth: 10 });
    expect(app.workspace.inspectorWidth).toBe(280);
    await settled(el);
    expect(el.querySelector<HTMLElement>('.win')?.style.getPropertyValue('--insp-w')).toBe('280px');
  });

  it('036: editor canvas: cột phải chỉ có Thuộc tính, Thông tin/Chẩn đoán ở khung dưới gập sẵn, nhấp tab thì mở', async () => {
    const { app } = await newApp();
    const el = await mount<MatShell>('mat-shell', app);
    app.openEditor('screen:main');
    await settled(el);
    const side = el.querySelector<HTMLElement>('mat-inspector.side-props')!;
    expect(side.querySelector('.insp-title')?.textContent).toBe('Thuộc tính');
    expect(side.querySelector('[role="tab"]')).toBeNull();
    const dock = el.querySelector<HTMLElement>('mat-inspector.info-dock')!;
    const tabs = [...dock.querySelectorAll('[role="tab"]')].map((b) => b.textContent!.trim());
    expect(tabs.map((x) => x.replace(/d+$/, '').trim())).toEqual(['Thông tin', 'Chẩn đoán']);
    expect(app.workspace.infoCollapsed).toBe(true);
    expect(dock.querySelector('.insp-body')).toBeNull();
    expect(el.querySelector<HTMLElement>('.win')?.style.getPropertyValue('--info-h')).toContain(
      '32px',
    );
    dock.querySelector<HTMLElement>('#insp-btab-diag')!.click();
    await settled(el);
    expect(app.workspace.infoCollapsed).toBe(false);
    expect(dock.querySelector('.insp-body')).not.toBeNull();
    expect(el.querySelector<HTMLElement>('.win')?.style.getPropertyValue('--info-h')).toBe('200px');
    // chọn phần tử (tab Thuộc tính) không làm gập khung dưới; cột phải vẫn hiện Thuộc tính
    app.setInspectorTab('props');
    await settled(el);
    expect(app.workspace.infoCollapsed).toBe(false);
    dock.querySelector<HTMLElement>('.insp-toggle')!.click();
    await settled(el);
    expect(app.workspace.infoCollapsed).toBe(true);
    // thanh kéo chiều cao khung dưới mở lại khung
    press(el.querySelector<HTMLElement>('[data-split="info"]')!, 'ArrowUp');
    expect(app.workspace.infoCollapsed).toBe(false);
    expect(app.workspace.infoHeight).toBe(216);
    await app.run('view.resetLayout');
    expect(app.workspace.infoCollapsed).toBe(true);
    expect(app.workspace.infoHeight).toBe(200);
    // editor bảng: khung dưới đầy đủ như cũ
    app.openEditor('tags');
    await settled(el);
    expect(el.querySelector('mat-inspector.info-dock')).toBeNull();
    expect(el.querySelectorAll('mat-inspector [role="tab"]').length).toBe(3);
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
    app.openEditor('phase:reports');
    await settled(el);
    expect(el.querySelector('#editor-panel')?.textContent).toContain('Báo cáo có ở GĐ 5');
  });
});
