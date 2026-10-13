// Phím của editor Màn hình (feature 007, T119, FR-071; contract studio-screen-editor §4). Hàm thuần đổi phím thành hành
// động; chỉ canvas và danh sách Lớp gọi khi CÓ focus (không đăng ký toàn cục, để Ctrl+D điền xuống ở lưới Bảng Tag và nhân
// bản ở canvas). Phím toàn cục của 004 đến 006 (Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+K, Ctrl+M, Ctrl+L, Ctrl+F, Ctrl+Shift+P, F6,
// F7) không có ở đây: canvas để chúng nổi lên cho `app/shortcuts.ts`.
import type { CommandId } from '../../app/commands.ts';

export interface CanvasKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type CanvasKeyAction =
  | { kind: 'command'; id: CommandId }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'tab'; reverse: boolean }
  | { kind: 'enter' }
  | { kind: 'escape' };

const CTRL: Readonly<Record<string, CommandId>> = {
  a: 'screen.selectAll',
  c: 'screen.copy',
  v: 'screen.paste',
  d: 'screen.duplicate',
};

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Đổi phím thành hành động của editor; `null` khi không phải phím của editor (để nổi lên). */
export function resolveCanvasKey(e: CanvasKey): CanvasKeyAction | null {
  if (e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey) {
    if (e.shiftKey) return null;
    const id = CTRL[k];
    return id ? { kind: 'command', id } : null;
  }
  const arrow = ARROWS[e.key];
  if (arrow) {
    const step = e.shiftKey ? 10 : 1;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  switch (e.key) {
    case 'Delete':
      return { kind: 'command', id: 'screen.delete' };
    case 'Tab':
      return { kind: 'tab', reverse: e.shiftKey };
    case 'Enter':
      return { kind: 'enter' };
    case 'Escape':
      return { kind: 'escape' };
  }
  // Dấu ngoặc theo `code` (đúng với mọi bố cục phím), rơi về `key` khi không có `code`.
  const bracketRight = e.code === 'BracketRight' || e.key === ']' || e.key === '}';
  const bracketLeft = e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
  if (bracketRight)
    return { kind: 'command', id: e.shiftKey ? 'screen.toFront' : 'screen.forward' };
  if (bracketLeft) return { kind: 'command', id: e.shiftKey ? 'screen.toBack' : 'screen.backward' };
  if (e.shiftKey) return null;
  switch (e.key) {
    case '+':
    case '=':
      return { kind: 'command', id: 'screen.zoomIn' };
    case '-':
    case '_':
      return { kind: 'command', id: 'screen.zoomOut' };
    case '0':
      return { kind: 'command', id: 'screen.zoomFit' };
    case '1':
      return { kind: 'command', id: 'screen.zoom100' };
    default:
      return null;
  }
}
