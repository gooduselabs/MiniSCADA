// Phím của trình vẽ SVG (feature 011, T162; FR-115; contracts/svg-editor.md §9): hàm thuần đổi phím thành hành động. Chỉ canvas
// của trình vẽ gọi khi CÓ focus; phím toàn cục của Studio (Ctrl+S, Ctrl+Z/Y, Ctrl+Shift+P, F6, F7, Ctrl+W) không có ở đây để
// chúng nổi lên `app/shortcuts.ts`. Mỗi lệnh có trong bảng lệnh (Ctrl+Shift+P) với id `svg.*`.
/** Phím như KeyboardEvent (để test không cần DOM). */
export interface SvgKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type SvgCommandId =
  | 'svg.toolSelect'
  | 'svg.toolNode'
  | 'svg.toolRect'
  | 'svg.toolEllipse'
  | 'svg.toolLine'
  | 'svg.toolPoly'
  | 'svg.toolText'
  | 'svg.toolHand'
  | 'svg.selectAll'
  | 'svg.copy'
  | 'svg.cut'
  | 'svg.paste'
  | 'svg.duplicate'
  | 'svg.delete'
  | 'svg.group'
  | 'svg.ungroup'
  | 'svg.toFront'
  | 'svg.toBack'
  | 'svg.forward'
  | 'svg.backward'
  | 'svg.alignLeft'
  | 'svg.alignCenter'
  | 'svg.alignRight'
  | 'svg.alignTop'
  | 'svg.alignMiddle'
  | 'svg.alignBottom'
  | 'svg.distributeH'
  | 'svg.distributeV'
  | 'svg.sameWidth'
  | 'svg.sameHeight'
  | 'svg.zoomIn'
  | 'svg.zoomOut'
  | 'svg.zoomFit'
  | 'svg.toggleGrid'
  | 'svg.snapGrid'
  | 'svg.snapObjects'
  | 'svg.snapPoints'
  | 'svg.snapAngle'
  | 'svg.addLayer'
  | 'svg.rename'
  | 'svg.closePath';

/** Lệnh của trình vẽ theo thứ tự trong bảng lệnh. */
export const SVG_COMMANDS: readonly SvgCommandId[] = [
  'svg.toolSelect',
  'svg.toolNode',
  'svg.toolRect',
  'svg.toolEllipse',
  'svg.toolLine',
  'svg.toolPoly',
  'svg.toolText',
  'svg.toolHand',
  'svg.selectAll',
  'svg.copy',
  'svg.cut',
  'svg.paste',
  'svg.duplicate',
  'svg.delete',
  'svg.group',
  'svg.ungroup',
  'svg.toFront',
  'svg.toBack',
  'svg.forward',
  'svg.backward',
  'svg.alignLeft',
  'svg.alignCenter',
  'svg.alignRight',
  'svg.alignTop',
  'svg.alignMiddle',
  'svg.alignBottom',
  'svg.distributeH',
  'svg.distributeV',
  'svg.sameWidth',
  'svg.sameHeight',
  'svg.zoomIn',
  'svg.zoomOut',
  'svg.zoomFit',
  'svg.toggleGrid',
  'svg.snapGrid',
  'svg.snapObjects',
  'svg.snapPoints',
  'svg.snapAngle',
  'svg.addLayer',
  'svg.rename',
  'svg.closePath',
];

/** Phím hiển thị của lệnh (bảng lệnh, tooltip, chú giải phím). */
export const SVG_KEYS: Readonly<Partial<Record<SvgCommandId, string>>> = {
  'svg.toolSelect': 'V',
  'svg.toolNode': 'N',
  'svg.toolRect': 'R',
  'svg.toolEllipse': 'E',
  'svg.toolLine': 'L',
  'svg.toolPoly': 'P',
  'svg.toolText': 'T',
  'svg.toolHand': 'H',
  'svg.selectAll': 'Ctrl+A',
  'svg.copy': 'Ctrl+C',
  'svg.cut': 'Ctrl+X',
  'svg.paste': 'Ctrl+V',
  'svg.duplicate': 'Ctrl+D',
  'svg.delete': 'Delete',
  'svg.group': 'Ctrl+G',
  'svg.ungroup': 'Ctrl+Shift+G',
  'svg.toFront': 'Ctrl+]',
  'svg.toBack': 'Ctrl+[',
  'svg.forward': ']',
  'svg.backward': '[',
  'svg.zoomIn': '+',
  'svg.zoomOut': '-',
  'svg.zoomFit': '0',
  'svg.rename': 'F2',
};

export type SvgKeyAction =
  | { kind: 'command'; id: SvgCommandId }
  /** Mũi tên: `grid` (Ctrl) dịch theo bước lưới. */
  | { kind: 'nudge'; dx: number; dy: number; grid: boolean }
  | { kind: 'tab'; reverse: boolean }
  | { kind: 'enter' }
  | { kind: 'escape' }
  /** Space giữ: kéo canvas. */
  | { kind: 'pan' };

const TOOL_KEYS: Readonly<Record<string, SvgCommandId>> = {
  v: 'svg.toolSelect',
  n: 'svg.toolNode',
  r: 'svg.toolRect',
  e: 'svg.toolEllipse',
  l: 'svg.toolLine',
  p: 'svg.toolPoly',
  t: 'svg.toolText',
  h: 'svg.toolHand',
};

const CTRL_KEYS: Readonly<Record<string, SvgCommandId>> = {
  a: 'svg.selectAll',
  c: 'svg.copy',
  x: 'svg.cut',
  v: 'svg.paste',
  d: 'svg.duplicate',
  g: 'svg.group',
};

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Đổi phím thành hành động của trình vẽ; `null` khi không phải phím của nó (để nổi lên). */
export function resolveSvgKey(e: SvgKey): SvgKeyAction | null {
  if (e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const bracketRight = e.code === 'BracketRight' || e.key === ']' || e.key === '}';
  const bracketLeft = e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
  const arrow = ARROWS[e.key];
  if (arrow) {
    const step = e.shiftKey ? 10 : 1;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step, grid: e.ctrlKey };
  }
  if (e.ctrlKey) {
    if (e.shiftKey) return k === 'g' ? { kind: 'command', id: 'svg.ungroup' } : null;
    if (bracketRight) return { kind: 'command', id: 'svg.toFront' };
    if (bracketLeft) return { kind: 'command', id: 'svg.toBack' };
    const id = CTRL_KEYS[k];
    return id ? { kind: 'command', id } : null;
  }
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      return { kind: 'command', id: 'svg.delete' };
    case 'Tab':
      return { kind: 'tab', reverse: e.shiftKey };
    case 'Enter':
      return { kind: 'enter' };
    case 'Escape':
      return { kind: 'escape' };
    case 'F2':
      return { kind: 'command', id: 'svg.rename' };
    case ' ':
      return { kind: 'pan' };
  }
  if (bracketRight) return { kind: 'command', id: 'svg.forward' };
  if (bracketLeft) return { kind: 'command', id: 'svg.backward' };
  if (e.key === '+' || e.key === '=') return { kind: 'command', id: 'svg.zoomIn' };
  if (e.key === '-' || e.key === '_') return { kind: 'command', id: 'svg.zoomOut' };
  if (e.shiftKey) return null;
  if (e.key === '0') return { kind: 'command', id: 'svg.zoomFit' };
  const tool = TOOL_KEYS[k];
  return tool ? { kind: 'command', id: tool } : null;
}
