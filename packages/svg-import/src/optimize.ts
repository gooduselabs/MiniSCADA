// Tối ưu tùy chọn (research R5 đã chỉnh sau spike T007; D22: mặc định tắt): gộp dãy phần tử liền kề cùng cha
// thuộc {line, polyline, polygon, path} có cùng thuộc tính đã giải thành một `path`.
// Điều kiện gộp: không `id` có nghĩa hoặc bị tham chiếu (id tự sinh không bị tham chiếu bỏ cùng phần tử), không
// `data-*`, cùng `transform` và thuộc tính trình bày, độ mờ vắng hoặc bằng 1, không filter/mask/marker, không
// ẩn, KHÔNG vừa có nền vừa có nét. Không gộp qua phần tử khác loại (giữ thứ tự vẽ). Không đệ quy.
import { SVG_NS, isNumber, scanNumberList } from '@mat/svg-renderer';
import { isMeaninglessId } from './name.ts';
import { collectReferences, inheritedAttr } from './refs.ts';

const MERGE_TAGS: ReadonlySet<string> = new Set(['line', 'polyline', 'polygon', 'path']);
const NO_DESCEND: ReadonlySet<string> = new Set([
  'defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'filter', 'linearGradient', 'radialGradient', 'text',
]); // prettier-ignore
const GEOMETRY: ReadonlySet<string> = new Set(['d', 'points', 'x1', 'y1', 'x2', 'y2', 'id']);
const MAX_D = 900_000;

export interface OptimizeResult {
  /** Số nhóm đã gộp. */
  merged: number;
  /** Số phần tử bớt đi. */
  elementsSaved: number;
}

function numStr(v: string | null): string | null {
  const s = (v ?? '0').trim();
  return isNumber(s) ? String(Number(s)) : null;
}

/** Đoạn `d` tương đương của phần tử; null nếu không biểu diễn được. */
function toD(el: Element): string | null {
  switch (el.localName) {
    case 'line': {
      const x1 = numStr(el.getAttribute('x1'));
      const y1 = numStr(el.getAttribute('y1'));
      const x2 = numStr(el.getAttribute('x2'));
      const y2 = numStr(el.getAttribute('y2'));
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return `M${x1} ${y1}L${x2} ${y2}`;
    }
    case 'polyline':
    case 'polygon': {
      const n = scanNumberList(el.getAttribute('points') ?? '');
      if (!n || n.length < 4 || n.length % 2 !== 0) return null;
      let d = `M${n[0]} ${n[1]}`;
      for (let i = 2; i < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
      return el.localName === 'polygon' ? d + 'Z' : d;
    }
    default: {
      const d = (el.getAttribute('d') ?? '').trim();
      const c = d.charCodeAt(0);
      if (c !== 77 && c !== 109) return null;
      return c === 109 ? 'M' + d.slice(1) : d;
    }
  }
}

function opacityOk(v: string | null): boolean {
  return v === null || Number(v.trim()) === 1;
}

/** Khóa gộp: chuỗi mô tả mọi thuộc tính không phải hình học; null nếu phần tử không được gộp. */
function mergeKey(el: Element, refs: ReadonlySet<string>): string | null {
  if (!MERGE_TAGS.has(el.localName)) return null;
  const id = el.getAttribute('id');
  if (id !== null && (refs.has(id) || !isMeaninglessId(id))) return null;
  for (const n of ['opacity', 'fill-opacity', 'stroke-opacity'])
    if (!opacityOk(el.getAttribute(n))) return null;
  if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden')
    return null;
  for (const n of ['filter', 'mask', 'marker-start', 'marker-mid', 'marker-end']) {
    const v = el.getAttribute(n);
    if (v !== null && v.trim() !== 'none') return null;
  }
  const fill = el.localName === 'line' ? 'none' : (inheritedAttr(el, 'fill') ?? 'black');
  const stroke = inheritedAttr(el, 'stroke') ?? 'none';
  if (fill !== 'none' && stroke !== 'none') return null;
  if (toD(el) === null) return null;
  const parts: string[] = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('data-')) return null;
    if (a.namespaceURI !== null) return null;
    if (GEOMETRY.has(a.name)) continue;
    parts.push(a.name + '=' + a.value);
  }
  parts.sort();
  return parts.join('|');
}

function mergeRun(parent: Element, run: Element[]): void {
  const first = run[0];
  const p = first.ownerDocument.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', run.map((e) => toD(e) as string).join(''));
  for (const a of Array.from(first.attributes))
    if (!GEOMETRY.has(a.name)) p.setAttribute(a.name, a.value);
  parent.insertBefore(p, first);
  for (const e of run) parent.removeChild(e);
}

export function optimizeSvg(root: Element): OptimizeResult {
  const refs = collectReferences(root);
  let merged = 0;
  let saved = 0;
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const parent = stack.pop()!;
    if (NO_DESCEND.has(parent.localName)) continue;
    const kids = Array.from(parent.children);
    let run: Element[] = [];
    let key: string | null = null;
    let len = 0;
    const flush = (): void => {
      if (run.length >= 2) {
        mergeRun(parent, run);
        merged++;
        saved += run.length - 1;
      }
      run = [];
      key = null;
      len = 0;
    };
    for (const ch of kids) {
      const k = mergeKey(ch, refs);
      if (k !== null && k === key) {
        const l = (toD(ch) as string).length;
        if (len + l > MAX_D) {
          flush();
          run = [ch];
          key = k;
          len = l;
        } else {
          run.push(ch);
          len += l;
        }
      } else {
        flush();
        if (k !== null) {
          run = [ch];
          key = k;
          len = (toD(ch) as string).length;
        }
      }
    }
    flush();
    for (const c of Array.from(parent.children))
      if (c.localName !== 'path' || c.children.length > 0) stack.push(c);
  }
  return { merged, elementsSaved: saved };
}
