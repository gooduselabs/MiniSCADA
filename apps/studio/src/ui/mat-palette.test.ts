// Bảng lệnh Ctrl+Shift+P (feature 004, T041, FR-009, contracts/commands.md): gõ lọc (không dấu); ↑ ↓;
// Enter chạy; Esc đóng; lệnh bị khóa hiện lý do, Enter chỉ báo lý do.
import { afterEach, describe, expect, it } from 'vitest';
import './mat-palette.ts';
import type { MatPalette } from './mat-palette.ts';
import { cleanup, mount, newApp, press, settled } from './test-helpers.ts';

const input = (el: Element) => el.querySelector<HTMLInputElement>('input')!;
const options = (el: Element) => [...el.querySelectorAll<HTMLElement>('[role="option"]')];
const current = (el: Element) =>
  el.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');

async function typeInto(el: MatPalette, text: string) {
  input(el).value = text;
  input(el).dispatchEvent(new Event('input', { bubbles: true }));
  await settled(el);
}

describe('mat-palette', () => {
  afterEach(cleanup);

  it('đóng thì không hiện; mở thì focus ô tìm và liệt kê lệnh', async () => {
    const { app } = await newApp();
    const el = await mount<MatPalette>('mat-palette', app);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    app.openPalette();
    await settled(el);
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(input(el));
    expect(options(el).length).toBeGreaterThan(20);
    expect(input(el).getAttribute('aria-activedescendant')).toBe(current(el)?.id);
  });

  it('gõ "bang tag" (không dấu) → "Mở Bảng Tag mặc định" đứng đầu; Enter mở đúng tab', async () => {
    const { app } = await newApp();
    const el = await mount<MatPalette>('mat-palette', app);
    app.openPalette();
    await settled(el);
    await typeInto(el, 'bang tag');
    expect(current(el)?.textContent).toContain('Mở Bảng Tag mặc định');
    press(input(el), 'Enter');
    await settled(el);
    expect(app.store.state.active).toBe('tags');
    expect(app.ui.palette).toBe(false);
  });

  it('↑ ↓ đổi mục chọn; Esc đóng', async () => {
    const { app } = await newApp();
    const el = await mount<MatPalette>('mat-palette', app);
    app.openPalette();
    await settled(el);
    const first = current(el)?.id;
    press(input(el), 'ArrowDown');
    await settled(el);
    expect(current(el)?.id).not.toBe(first);
    press(input(el), 'ArrowUp');
    await settled(el);
    expect(current(el)?.id).toBe(first);
    press(input(el), 'Escape');
    await settled(el);
    expect(app.ui.palette).toBe(false);
  });

  it('lệnh bị khóa hiện lý do; Enter chỉ báo lý do, bảng lệnh vẫn mở', async () => {
    const { app } = await newApp();
    const el = await mount<MatPalette>('mat-palette', app);
    app.openPalette();
    await settled(el);
    await typeInto(el, 'nap xuong');
    expect(current(el)?.textContent).toContain('Nạp xuống…');
    expect(current(el)?.textContent).toContain('Có ở feature 005');
    expect(current(el)?.getAttribute('aria-disabled')).toBe('true');
    press(input(el), 'Enter');
    await settled(el);
    expect(app.ui.palette).toBe(true);
    expect(app.ui.toast?.text).toBe('Nạp xuống…: Có ở feature 005');
  });

  it('không có lệnh khớp thì báo', async () => {
    const { app } = await newApp();
    const el = await mount<MatPalette>('mat-palette', app);
    app.openPalette();
    await settled(el);
    await typeInto(el, 'zzzz');
    expect(options(el)).toHaveLength(0);
    expect(el.textContent).toContain('Không có lệnh khớp');
  });
});
