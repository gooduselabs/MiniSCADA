// Phần tử mới của các công cụ (contracts/svg-editor.md §8; FR-099, FR-108): mặc định tô/viền, phông an toàn
// (`W_SVG_FONT` khi phông khác), uid mới, chèn trên cùng của cha (hoặc lớp).
import type { NodeSpec } from './build.ts';
import { Batch } from './command.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { formatPoints, type Pt } from './path.ts';
import { insertSpec } from './structure.ts';
import { fmt } from './transform.ts';

export const SAFE_FONTS: readonly string[] = [
  'sans-serif',
  'serif',
  'monospace',
  'Arial',
  'Segoe UI',
  'Roboto',
];

/** Cảnh báo khi họ phông không thuộc danh sách an toàn (máy vận hành có thể không có phông đó). */
export function checkFont(family: string): 'W_SVG_FONT' | null {
  const parts = family.split(',').map((s) => {
    let t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
      t = t.slice(1, -1);
    return t;
  });
  return parts.every((p) => SAFE_FONTS.includes(p)) ? null : 'W_SVG_FONT';
}

export type ShapeInput =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline' | 'polygon'; points: readonly Pt[] }
  | { kind: 'text'; x: number; y: number; text: string; fontSize?: number; fontFamily?: string };

const FILLED: Array<[string, string]> = [
  ['fill', '#cfd8dc'],
  ['stroke', '#37474f'],
  ['stroke-width', '2'],
];
const STROKED: Array<[string, string]> = [
  ['fill', 'none'],
  ['stroke', '#37474f'],
  ['stroke-width', '2'],
];

/** Mô tả phần tử mới với mặc định của contract §8 và `data-mat-uid` mới. */
export function shapeSpec(doc: DrawDoc, s: ShapeInput): NodeSpec {
  const uid: [string, string] = ['data-mat-uid', doc.uid()];
  switch (s.kind) {
    case 'rect': {
      const attrs: Array<[string, string]> = [
        uid,
        ['x', fmt(s.x)],
        ['y', fmt(s.y)],
        ['width', fmt(s.width)],
        ['height', fmt(s.height)],
      ];
      if (s.rx !== undefined) attrs.push(['rx', fmt(s.rx)]);
      if (s.ry !== undefined) attrs.push(['ry', fmt(s.ry)]);
      return { tag: 'rect', attrs: [...attrs, ...FILLED] };
    }
    case 'ellipse':
      return {
        tag: 'ellipse',
        attrs: [
          uid,
          ['cx', fmt(s.cx)],
          ['cy', fmt(s.cy)],
          ['rx', fmt(s.rx)],
          ['ry', fmt(s.ry)],
          ...FILLED,
        ],
      };
    case 'circle':
      return {
        tag: 'circle',
        attrs: [uid, ['cx', fmt(s.cx)], ['cy', fmt(s.cy)], ['r', fmt(s.r)], ...FILLED],
      };
    case 'line':
      return {
        tag: 'line',
        attrs: [
          uid,
          ['x1', fmt(s.x1)],
          ['y1', fmt(s.y1)],
          ['x2', fmt(s.x2)],
          ['y2', fmt(s.y2)],
          ...STROKED,
        ],
      };
    case 'polyline':
      return { tag: 'polyline', attrs: [uid, ['points', formatPoints(s.points)], ...STROKED] };
    case 'polygon':
      return { tag: 'polygon', attrs: [uid, ['points', formatPoints(s.points)], ...FILLED] };
    case 'text':
      return {
        tag: 'text',
        attrs: [
          uid,
          ['x', fmt(s.x)],
          ['y', fmt(s.y)],
          ['fill', '#263238'],
          ['font-size', fmt(s.fontSize ?? 16)],
          ['font-family', s.fontFamily ?? 'sans-serif'],
          ['text-anchor', 'start'],
        ],
        text: s.text,
      };
  }
}

/** Lô chèn phần tử mới lên trên cùng của `parent` (mặc định gốc). */
export function createShape(
  doc: DrawDoc,
  s: ShapeInput,
  parent: NodeId = doc.root,
): { batch: Batch; id: NodeId; warning: 'W_SVG_FONT' | null } {
  const ins = insertSpec(doc, parent, shapeSpec(doc, s));
  const warning = s.kind === 'text' && s.fontFamily !== undefined ? checkFont(s.fontFamily) : null;
  return { batch: new Batch([ins.command], { label: 'Vẽ' }), id: ins.id, warning };
}

/** Tài liệu SVG trống (lệnh "Mới: SVG trống" với viewBox chọn được). */
export function blankSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}">\n</svg>\n`;
}
