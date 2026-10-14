// Phím của editor Màn hình (feature 007, T119): bảng phím của contract §4, không bắt phím toàn cục của 004 đến 006 và
// không xung đột: Ctrl+D ở canvas là nhân bản, ở lưới là điền xuống (phím toàn cục `edit.fillDown`).
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../app/commands.ts';
import { resolveShortcut } from '../../app/shortcuts.ts';
import { resolveCanvasKey, type CanvasKey } from './keymap.ts';

const key = (k: string, over: Partial<CanvasKey> = {}): CanvasKey => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

describe('phím của canvas', () => {
  it.each([
    ['a', 'screen.selectAll'],
    ['c', 'screen.copy'],
    ['v', 'screen.paste'],
    ['d', 'screen.duplicate'],
  ])('Ctrl+%s → %s', (k, id) => {
    expect(resolveCanvasKey(key(k, { ctrlKey: true }))).toEqual({ kind: 'command', id });
    expect(resolveCanvasKey(key(k.toUpperCase(), { ctrlKey: true }))).toEqual({
      kind: 'command',
      id,
    });
  });

  it('Delete xóa; Esc, Enter, Tab theo thứ tự lớp', () => {
    expect(resolveCanvasKey(key('Delete'))).toEqual({ kind: 'command', id: 'screen.delete' });
    expect(resolveCanvasKey(key('Escape'))).toEqual({ kind: 'escape' });
    expect(resolveCanvasKey(key('Enter'))).toEqual({ kind: 'enter' });
    expect(resolveCanvasKey(key('Tab'))).toEqual({ kind: 'tab', reverse: false });
    expect(resolveCanvasKey(key('Tab', { shiftKey: true }))).toEqual({
      kind: 'tab',
      reverse: true,
    });
  });

  it('mũi tên dịch 1, Shift+mũi tên dịch 10 (đơn vị thiết kế)', () => {
    expect(resolveCanvasKey(key('ArrowLeft'))).toEqual({ kind: 'nudge', dx: -1, dy: 0 });
    expect(resolveCanvasKey(key('ArrowDown', { shiftKey: true }))).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: 10,
    });
  });

  it('dấu ngoặc: ] lên một lớp, [ xuống một lớp, Shift cho trên cùng và dưới cùng', () => {
    expect(resolveCanvasKey(key(']'))).toEqual({ kind: 'command', id: 'screen.forward' });
    expect(resolveCanvasKey(key('['))).toEqual({ kind: 'command', id: 'screen.backward' });
    expect(resolveCanvasKey(key('}', { shiftKey: true, code: 'BracketRight' }))).toEqual({
      kind: 'command',
      id: 'screen.toFront',
    });
    expect(resolveCanvasKey(key('{', { shiftKey: true, code: 'BracketLeft' }))).toEqual({
      kind: 'command',
      id: 'screen.toBack',
    });
  });

  it('+, -, 0, 1: zoom vào, ra, vừa khung, 100 %', () => {
    expect(resolveCanvasKey(key('+'))).toEqual({ kind: 'command', id: 'screen.zoomIn' });
    expect(resolveCanvasKey(key('-'))).toEqual({ kind: 'command', id: 'screen.zoomOut' });
    expect(resolveCanvasKey(key('0'))).toEqual({ kind: 'command', id: 'screen.zoomFit' });
    expect(resolveCanvasKey(key('1'))).toEqual({ kind: 'command', id: 'screen.zoom100' });
  });

  it('không bắt phím toàn cục: Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+K, Ctrl+M, Ctrl+L, Ctrl+F, Ctrl+Shift+P, F6, F7, Alt+phím', () => {
    for (const k of ['s', 'z', 'y', 'k', 'm', 'l', 'f'])
      expect(resolveCanvasKey(key(k, { ctrlKey: true })), `Ctrl+${k}`).toBeNull();
    expect(resolveCanvasKey(key('P', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveCanvasKey(key('F6'))).toBeNull();
    expect(resolveCanvasKey(key('F7'))).toBeNull();
    expect(resolveCanvasKey(key('1', { altKey: true }))).toBeNull();
    expect(resolveCanvasKey(key('a', { metaKey: true }))).toBeNull();
  });

  it('Ctrl+D xung đột có chủ ý: toàn cục là điền xuống, canvas nhân bản (canvas chặn nổi lên)', () => {
    const e = { key: 'd', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(resolveShortcut(e, { inTextField: false, modal: false })).toEqual({
      command: 'edit.fillDown',
    });
    expect(resolveCanvasKey(key('d', { ctrlKey: true }))).toEqual({
      kind: 'command',
      id: 'screen.duplicate',
    });
  });

  it('phím của canvas khai ở bảng lệnh (canvasKey) và không trùng phím toàn cục (shortcut)', () => {
    const globals = new Set(COMMANDS.map((c) => c.shortcut).filter(Boolean));
    for (const c of COMMANDS.filter((x) => x.canvasKey)) {
      // Ctrl+D, Delete và Insert dùng chung chủ ý với lưới và cây (chỉ có hiệu lực khi canvas, lưới alarm có focus).
      if (['Ctrl+D', 'Delete', 'Insert'].includes(c.canvasKey ?? '')) continue;
      expect(globals.has(c.canvasKey), `${c.id} ${c.canvasKey}`).toBe(false);
    }
  });
});
