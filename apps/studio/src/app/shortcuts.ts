// Phím tắt của Studio (feature 004, T054, FR-010, contracts/commands.md, research R15). Hàm thuần đổi phím
// thành hành động; `installShortcuts` gắn vào document. Phím của Studio chặn hành vi mặc định để WebView2
// không chạy phím tắt trình duyệt trùng; phím làm mất việc đang làm (tải lại trang, in, lùi trang) luôn bị
// chặn. Thành phần đã tự xử lý phím (gọi preventDefault) thì bỏ qua.
import type { StudioApp } from './app.ts';
import type { CommandId } from './commands.ts';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface KeyContext {
  /** Focus đang ở ô nhập chữ: Ctrl+Z/Y là hoàn tác của ô nhập. */
  inTextField: boolean;
  /** Đang có hộp thoại hoặc bảng lệnh: chỉ chặn phím trình duyệt. */
  modal: boolean;
}

export type ShortcutAction =
  { command: CommandId } | { block: true } | { closeTab: true } | { focusMenu: true };

const CTRL: Readonly<Record<string, CommandId>> = {
  s: 'project.save',
  o: 'project.open',
  z: 'edit.undo',
  y: 'edit.redo',
  f: 'edit.find',
  d: 'edit.fillDown',
  k: 'online.connect',
  m: 'online.disconnect',
  l: 'online.download',
};

const BLOCK: ShortcutAction = { block: true };

/** Phím của trình duyệt làm mất thay đổi chưa lưu hoặc rời trang. */
function browserKey(e: KeyLike, k: string): boolean {
  if (e.key === 'F5' || e.key === 'BrowserBack' || e.key === 'BrowserForward') return true;
  if (e.key === 'BrowserRefresh') return true;
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return true;
  if (e.ctrlKey && !e.altKey && (k === 'r' || (k === 'p' && !e.shiftKey))) return true;
  return false;
}

export function resolveShortcut(e: KeyLike, ctx: KeyContext): ShortcutAction | null {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (browserKey(e, k)) return BLOCK;
  if (ctx.modal) return null;
  if (e.metaKey) return null;
  if (!e.ctrlKey && !e.altKey) {
    if (e.key === 'F6') return { command: e.shiftKey ? 'view.prevRegion' : 'view.nextRegion' };
    if (e.key === 'F7' && !e.shiftKey) return { command: 'tools.validate' };
    if (e.key === 'F10' && !e.shiftKey) return { focusMenu: true };
    return null;
  }
  if (!e.ctrlKey || e.altKey) return null;
  if (e.shiftKey) {
    if (k === 'p') return { command: 'view.palette' };
    // Thêm đồ họa SVG (feature 008): nhập vào màn hình đang mở.
    if (k === 'i') return { command: 'import.svg' };
    // Ghi dòng đã chọn của Bảng theo dõi (feature 006): luôn qua hộp xác nhận.
    if (k === 'Enter') return { command: 'watch.write' };
    return null;
  }
  if (k === 'w') return { closeTab: true };
  const command = CTRL[k];
  if (!command) return null;
  if (ctx.inTextField && (k === 'z' || k === 'y')) return null;
  if (ctx.inTextField && k === 'd') return BLOCK;
  return { command };
}

/** Ô nhập dùng chung của lưới (mat-grid) luôn giữ focus: ở chế độ di chuyển nó không phải ô nhập chữ. */
const isGridCursor = (el: EventTarget | null): boolean =>
  el instanceof HTMLTextAreaElement &&
  el.classList.contains('mg-input') &&
  !el.classList.contains('mg-editing');

const isTextField = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  !isGridCursor(el) &&
  (el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement &&
      !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(el.type)));

/** Gắn phím tắt vào document; trả hàm gỡ. */
export function installShortcuts(doc: Document, app: StudioApp): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const action = resolveShortcut(e, {
      inTextField: isTextField(e.target),
      modal: app.ui.dialog !== null || app.ui.palette,
    });
    if (!action) return;
    e.preventDefault();
    if ('command' in action) void app.run(action.command);
    else if ('closeTab' in action) app.closeTab(app.store.state.active);
    else if ('focusMenu' in action) app.hooks.focusMenu?.();
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}
