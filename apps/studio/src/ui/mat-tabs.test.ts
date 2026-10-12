// Dải tab editor (feature 004, T041, FR-005, FR-011, contracts/commands.md): mẫu ARIA tablist; ← → chuyển;
// Delete/Ctrl+W đóng tab đang chọn (trừ Bắt đầu); không tạo tab trùng; dấu chưa lưu.
import { afterEach, describe, expect, it } from 'vitest';
import './mat-tabs.ts';
import type { MatTabs } from './mat-tabs.ts';
import { cleanup, mount, newApp, press, settled } from './test-helpers.ts';

const tabs = (el: Element) => [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
const titles = (el: Element) => tabs(el).map((t) => t.querySelector('.tab-title')?.textContent);

describe('mat-tabs', () => {
  afterEach(cleanup);

  it('tablist; tab đang chọn có aria-selected và nhận Tab, tab khác tabindex -1', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    app.openEditor('settings');
    const el = await mount<MatTabs>('mat-tabs', app);
    expect(el.getAttribute('role')).toBe('tablist');
    expect(titles(el)).toEqual(['Bắt đầu', 'Bảng Tag mặc định', 'Thiết lập project']);
    const [start, tags, settings] = tabs(el);
    expect(settings.getAttribute('aria-selected')).toBe('true');
    expect(settings.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(-1);
    expect(tags.getAttribute('aria-selected')).toBe('false');
    expect(settings.getAttribute('aria-controls')).toBe('editor-panel');
  });

  it('← → chuyển tab và focus theo', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    app.openEditor('settings');
    const el = await mount<MatTabs>('mat-tabs', app);
    press(tabs(el)[2], 'ArrowLeft');
    await settled(el);
    expect(app.store.state.active).toBe('tags');
    expect(document.activeElement).toBe(tabs(el)[1]);
    press(tabs(el)[1], 'ArrowRight');
    await settled(el);
    expect(app.store.state.active).toBe('settings');
  });

  it('Delete hoặc Ctrl+W đóng tab đang chọn; Bắt đầu không đóng được, không có nút đóng', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    app.openEditor('settings');
    const el = await mount<MatTabs>('mat-tabs', app);
    press(tabs(el)[2], 'Delete');
    await settled(el);
    expect(titles(el)).toEqual(['Bắt đầu', 'Bảng Tag mặc định']);
    press(tabs(el)[1], 'w', { ctrlKey: true });
    await settled(el);
    expect(titles(el)).toEqual(['Bắt đầu']);
    press(tabs(el)[0], 'Delete');
    await settled(el);
    expect(titles(el)).toEqual(['Bắt đầu']);
    expect(tabs(el)[0].querySelector('.x')).toBeNull();
  });

  it('nút đóng trên tab; nhấp tab thì chọn', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    app.openEditor('settings');
    const el = await mount<MatTabs>('mat-tabs', app);
    tabs(el)[1].click();
    expect(app.store.state.active).toBe('tags');
    tabs(el)[2].querySelector<HTMLElement>('.x')?.click();
    await settled(el);
    expect(titles(el)).toEqual(['Bắt đầu', 'Bảng Tag mặc định']);
  });

  it('dấu chưa lưu trên tab của editor có thay đổi', async () => {
    const { app } = await newApp();
    app.openEditor('tags');
    const el = await mount<MatTabs>('mat-tabs', app);
    expect(tabs(el)[1].querySelector('.dirty')).toBeNull();
    app.store.edit([{ kind: 'tagField', index: 0, field: 'unit', value: 'm' }]);
    await settled(el);
    expect(tabs(el)[1].querySelector('.dirty')).not.toBeNull();
    expect(tabs(el)[1].title).toBe('Bảng Tag mặc định (chưa lưu)');
  });

  it('mở lại editor đã mở không tạo tab trùng', async () => {
    const { app } = await newApp();
    const el = await mount<MatTabs>('mat-tabs', app);
    app.openEditor('tags');
    app.openEditor('start');
    app.openEditor('tags');
    await settled(el);
    expect(titles(el)).toEqual(['Bắt đầu', 'Bảng Tag mặc định']);
  });
});
