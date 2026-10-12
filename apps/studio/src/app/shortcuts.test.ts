// Phím tắt (feature 004, T054, FR-010, contracts/commands.md, research R15): phím → lệnh; chặn phím của
// trình duyệt làm mất việc đang làm (F5, Ctrl+R, Ctrl+P, Alt+←); Ctrl+Z/Y trong ô nhập là của ô nhập.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';
import { installShortcuts, resolveShortcut, type KeyContext } from './shortcuts.ts';

const key = (k: string, mods: Partial<Record<'ctrl' | 'shift' | 'alt', boolean>> = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: false,
});
const plain: KeyContext = { inTextField: false, modal: false };

describe('resolveShortcut', () => {
  it.each([
    [key('s', { ctrl: true }), 'project.save'],
    [key('S', { ctrl: true }), 'project.save'],
    [key('o', { ctrl: true }), 'project.open'],
    [key('z', { ctrl: true }), 'edit.undo'],
    [key('y', { ctrl: true }), 'edit.redo'],
    [key('f', { ctrl: true }), 'edit.find'],
    [key('d', { ctrl: true }), 'edit.fillDown'],
    [key('P', { ctrl: true, shift: true }), 'view.palette'],
    [key('k', { ctrl: true }), 'online.connect'],
    [key('m', { ctrl: true }), 'online.disconnect'],
    [key('l', { ctrl: true }), 'online.download'],
    [key('F6'), 'view.nextRegion'],
    [key('F6', { shift: true }), 'view.prevRegion'],
    [key('F7'), 'tools.validate'],
  ])('%o → %s', (e, command) => {
    expect(resolveShortcut(e, plain)).toEqual({ command });
  });

  it('chặn phím trình duyệt: tải lại trang, in, lùi/tiến trang', () => {
    for (const e of [
      key('F5'),
      key('F5', { ctrl: true }),
      key('r', { ctrl: true }),
      key('R', { ctrl: true, shift: true }),
      key('p', { ctrl: true }),
      key('ArrowLeft', { alt: true }),
      key('ArrowRight', { alt: true }),
      key('BrowserBack'),
    ])
      expect(resolveShortcut(e, plain), e.key).toEqual({ block: true });
  });

  it('Ctrl+W đóng tab; F10 vào menu', () => {
    expect(resolveShortcut(key('w', { ctrl: true }), plain)).toEqual({ closeTab: true });
    expect(resolveShortcut(key('F10'), plain)).toEqual({ focusMenu: true });
  });

  it('trong ô nhập: Ctrl+Z/Y để cho ô nhập, Ctrl+D chỉ chặn; Ctrl+S vẫn lưu', () => {
    const field: KeyContext = { inTextField: true, modal: false };
    expect(resolveShortcut(key('z', { ctrl: true }), field)).toBeNull();
    expect(resolveShortcut(key('y', { ctrl: true }), field)).toBeNull();
    expect(resolveShortcut(key('d', { ctrl: true }), field)).toEqual({ block: true });
    expect(resolveShortcut(key('s', { ctrl: true }), field)).toEqual({ command: 'project.save' });
  });

  it('khi có hộp thoại hay bảng lệnh: chỉ chặn phím trình duyệt, không chạy lệnh', () => {
    const modal: KeyContext = { inTextField: false, modal: true };
    expect(resolveShortcut(key('s', { ctrl: true }), modal)).toBeNull();
    expect(resolveShortcut(key('F7'), modal)).toBeNull();
    expect(resolveShortcut(key('F5'), modal)).toEqual({ block: true });
  });

  it('phím thường không phải phím tắt', () => {
    expect(resolveShortcut(key('a'), plain)).toBeNull();
    expect(resolveShortcut(key('Enter'), plain)).toBeNull();
    expect(resolveShortcut(key('x', { ctrl: true }), plain)).toBeNull();
  });
});

describe('installShortcuts', () => {
  afterEach(() => document.body.replaceChildren());

  it('phím trên document chạy lệnh của app và chặn hành vi mặc định; phím đã xử lý thì bỏ qua', async () => {
    const app = new StudioApp({ platform: createMockPlatform(), storage: null });
    const run = vi.spyOn(app, 'run').mockResolvedValue();
    const off = installShortcuts(document, app);
    const ev = new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(run).toHaveBeenCalledWith('tools.validate');
    expect(ev.defaultPrevented).toBe(true);
    const handled = new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(run).toHaveBeenCalledTimes(1);
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    off();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+Enter: Ghi dòng đã chọn (feature 006)', () => {
    expect(
      resolveShortcut(
        { key: 'Enter', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false },
        { inTextField: false, modal: false },
      ),
    ).toEqual({ command: 'watch.write' });
    expect(
      resolveShortcut(
        { key: 'Enter', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
        { inTextField: false, modal: false },
      ),
    ).toBeNull();
  });

  it('ô nhập dùng chung của lưới (textarea.mg-input): ở chế độ di chuyển Ctrl+Z là hoàn tác project; đang sửa thì là hoàn tác của ô (feature 006)', () => {
    const app = new StudioApp({ platform: createMockPlatform(), storage: null });
    const run = vi.spyOn(app, 'run').mockResolvedValue();
    const off = installShortcuts(document, app);
    const ta = document.createElement('textarea');
    ta.className = 'mg-input';
    document.body.append(ta);
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(run).toHaveBeenCalledWith('edit.undo');
    ta.classList.add('mg-editing');
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    off();
  });
});
