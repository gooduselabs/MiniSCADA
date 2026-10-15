// Chữ ký phần tử cho nhập lại (contract svg-import §7; ADR-023 mục 7): { tag, style, box, kids }.
// Hộp bao tính từ THUỘC TÍNH (không layout, không getBBox: jsdom không có, Constitution V), áp `transform`
// của phần tử và mọi tổ tiên bằng `parseTransformMatrix` (@mat/svg-renderer, T021). Duyệt không đệ quy.
import { isAsciiLetter, isWs, parseTransformMatrix, scanNumber } from '@mat/svg-renderer';
import type { Matrix2D } from '@mat/svg-renderer';
import { isBindable } from './uid.ts';

/** Hộp bao [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];
export type ViewBox = [number, number, number, number];

export interface SigItem {
  el: Element;
  /** Đường dẫn `/svg/g[2]/rect[1]` (chỉ số 1 trong các anh em cùng thẻ; gốc không có chỉ số). */
  path: string;
  tag: string;
  id: string | null;
  uid: string | null;
  /** Thuộc tính trình bày của chính phần tử. */
  style: Record<string, string>;
  /** Hộp bao trong hệ tọa độ viewBox; null khi không tính được (g rỗng, hình thiếu thuộc tính). */
  box: Box | null;
  /** Số phần tử gắn được con trực tiếp. */
  kids: number;
  /** Chỉ số (trong `items`) của tổ tiên gắn được gần nhất; -1 nếu ở mức cao nhất. */
  parent: number;
}

export interface SignatureSet {
  items: SigItem[];
  viewBox: ViewBox;
  /** Đường chéo viewBox. */
  diag: number;
  /** Số lần xuất hiện của từng `id` trên MỌI phần tử của tài liệu. */
  idCount: Map<string, number>;
}

const STYLE_ATTRS = [
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'font-size',
  'font-family',
  'font-weight',
  'stroke-dasharray',
  'visibility',
  'display',
] as const;

/** Phạt cho mỗi thuộc tính trình bày khác nhau và trần của phần phạt (contract §7). */
export const STYLE_PENALTY = 0.02;
export const STYLE_PENALTY_CAP = 0.1;

function skipWs(s: string, i: number): number {
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  return i;
}

const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

function mul(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function boxOfMatrix(m: Matrix2D, b: Box): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? b[2] : b[0];
    const y = i & 2 ? b[3] : b[1];
    const tx = m[0] * x + m[2] * y + m[4];
    const ty = m[1] * x + m[3] * y + m[5];
    if (tx < x0) x0 = tx;
    if (tx > x1) x1 = tx;
    if (ty < y0) y0 = ty;
    if (ty > y1) y1 = ty;
  }
  return [x0, y0, x1, y1];
}

function unionInto(acc: Box | null, b: Box): Box {
  if (acc === null) return [b[0], b[1], b[2], b[3]];
  if (b[0] < acc[0]) acc[0] = b[0];
  if (b[1] < acc[1]) acc[1] = b[1];
  if (b[2] > acc[2]) acc[2] = b[2];
  if (b[3] > acc[3]) acc[3] = b[3];
  return acc;
}

const num = (el: Element, name: string, dflt = 0): number => {
  const v = el.getAttribute(name);
  if (v === null) return dflt;
  const s = scanNumber(v.trim(), 0);
  return s === null ? dflt : s.value;
};

function pointsBox(v: string | null): Box | null {
  if (v === null) return null;
  let acc: Box | null = null;
  let i = skipWs(v, 0);
  const nums: number[] = [];
  while (i < v.length) {
    const n = scanNumber(v, i);
    if (n === null) break;
    nums.push(n.value);
    i = skipWs(v, n.end);
    if (v.charCodeAt(i) === 44) i = skipWs(v, i + 1);
  }
  for (let k = 0; k + 1 < nums.length; k += 2) acc = unionInto(acc, [nums[k], nums[k + 1], nums[k], nums[k + 1]]);
  return acc;
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Hộp bao các điểm điều khiển của `d` (đã quy về tuyệt đối); cung chỉ tính điểm cuối. */
function pathBox(d: string | null): Box | null {
  if (d === null) return null;
  let acc: Box | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const add = (x: number, y: number): void => {
    acc = unionInto(acc, [x, y, x, y]);
  };
  let i = skipWs(d, 0);
  let cmd = '';
  while (i < d.length) {
    const ch = d[i];
    if (isAsciiLetter(ch.charCodeAt(0))) {
      cmd = ch;
      i = skipWs(d, i + 1);
      if (cmd === 'Z' || cmd === 'z') {
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (cmd === '') break;
    const lower = cmd.toLowerCase();
    const need = ARGS[lower];
    if (need === undefined || need === 0) break;
    const rel = cmd === lower;
    const a: number[] = [];
    for (let k = 0; k < need; k++) {
      i = skipWs(d, i);
      if (d.charCodeAt(i) === 44) i = skipWs(d, i + 1);
      // cờ của cung là một chữ số, có thể viết sát nhau ("01")
      if (lower === 'a' && (k === 3 || k === 4)) {
        const c = d[i];
        if (c !== '0' && c !== '1') return acc;
        a.push(Number(c));
        i++;
        continue;
      }
      const n = scanNumber(d, i);
      if (n === null) return acc;
      a.push(n.value);
      i = n.end;
    }
    i = skipWs(d, i);
    if (d.charCodeAt(i) === 44) i = skipWs(d, i + 1);
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (lower) {
      case 'm':
        cx = ox + a[0];
        cy = oy + a[1];
        sx = cx;
        sy = cy;
        add(cx, cy);
        cmd = rel ? 'l' : 'L';
        break;
      case 'l':
      case 't':
        cx = ox + a[0];
        cy = oy + a[1];
        add(cx, cy);
        break;
      case 'h':
        cx = ox + a[0];
        add(cx, cy);
        break;
      case 'v':
        cy = oy + a[0];
        add(cx, cy);
        break;
      case 'c':
        add(ox + a[0], oy + a[1]);
        add(ox + a[2], oy + a[3]);
        cx = ox + a[4];
        cy = oy + a[5];
        add(cx, cy);
        break;
      case 's':
      case 'q':
        add(ox + a[0], oy + a[1]);
        cx = ox + a[2];
        cy = oy + a[3];
        add(cx, cy);
        break;
      case 'a':
        cx = ox + a[5];
        cy = oy + a[6];
        add(cx, cy);
        break;
    }
  }
  return acc;
}

/** Hộp bao của hình theo thuộc tính, trong hệ tọa độ của chính phần tử (chưa áp `transform`). */
function shapeBox(el: Element): Box | null {
  switch (el.localName) {
    case 'rect':
    case 'image': {
      if (!el.hasAttribute('width') || !el.hasAttribute('height')) return null;
      const x = num(el, 'x');
      const y = num(el, 'y');
      return [x, y, x + num(el, 'width'), y + num(el, 'height')];
    }
    case 'circle': {
      const r = num(el, 'r');
      const cx = num(el, 'cx');
      const cy = num(el, 'cy');
      return [cx - r, cy - r, cx + r, cy + r];
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      const cx = num(el, 'cx');
      const cy = num(el, 'cy');
      return [cx - rx, cy - ry, cx + rx, cy + ry];
    }
    case 'line': {
      const x1 = num(el, 'x1');
      const x2 = num(el, 'x2');
      const y1 = num(el, 'y1');
      const y2 = num(el, 'y2');
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }
    case 'polyline':
    case 'polygon':
      return pointsBox(el.getAttribute('points'));
    case 'path':
      return pathBox(el.getAttribute('d'));
    case 'text': {
      let x = num(el, 'x');
      let y = num(el, 'y');
      const t = el.firstElementChild;
      if (t && t.localName === 'tspan') {
        if (!el.hasAttribute('x')) x = num(t, 'x', x);
        if (!el.hasAttribute('y')) y = num(t, 'y', y);
      }
      const fs = num(el, 'font-size', 16);
      const w = fs * (el.textContent ?? '').length * 0.6;
      const anchor = el.getAttribute('text-anchor');
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      return [x0, y - fs, x0 + w, y];
    }
    default:
      return null;
  }
}

function viewBoxOf(root: Element): ViewBox {
  const vb = root.getAttribute('viewBox');
  if (vb !== null) {
    const nums: number[] = [];
    let i = skipWs(vb, 0);
    while (i < vb.length) {
      const n = scanNumber(vb, i);
      if (n === null) break;
      nums.push(n.value);
      i = skipWs(vb, n.end);
      if (vb.charCodeAt(i) === 44) i = skipWs(vb, i + 1);
    }
    if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) return [nums[0], nums[1], nums[2], nums[3]];
  }
  const w = num(root, 'width', 100);
  const h = num(root, 'height', 100);
  return [0, 0, w > 0 ? w : 100, h > 0 ? h : 100];
}

interface Rec {
  el: Element;
  parent: number;
  path: string;
  m: Matrix2D;
  own: Box | null;
  abs: Matrix2D;
  inNon: boolean;
}

const NON_BINDABLE_CONTAINER = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'filter']);

/**
 * Chữ ký của mọi phần tử gắn được. Khi có `mapTo`, tọa độ được quy từ viewBox của tài liệu này về `mapTo`
 * (để so hai bản có viewBox khác cỡ: bản LibreOffice dùng 1/100 mm).
 */
export function buildSignatures(root: Element, mapTo?: ViewBox): SignatureSet {
  const viewBox = viewBoxOf(root);
  let base: Matrix2D = IDENTITY;
  if (mapTo) {
    const sx = mapTo[2] / viewBox[2];
    const sy = mapTo[3] / viewBox[3];
    base = [sx, 0, 0, sy, mapTo[0] - viewBox[0] * sx, mapTo[1] - viewBox[1] * sy];
  }
  const recs: Rec[] = [];
  const byId = new Map<string, number>();
  const idCount = new Map<string, number>();
  // 1. duyệt tiền thứ tự (ngăn xếp), ghi cha, đường dẫn, ma trận
  const stack: Array<{ el: Element; parent: number; path: string; inNon: boolean }> = [
    { el: root, parent: -1, path: '/svg', inNon: false },
  ];
  while (stack.length > 0) {
    const f = stack.pop()!;
    const idx = recs.length;
    const tm = f.el.getAttribute('transform');
    const m = (tm !== null ? parseTransformMatrix(tm) : null) ?? IDENTITY;
    const parentAbs = f.parent >= 0 ? recs[f.parent].abs : base;
    recs.push({
      el: f.el,
      parent: f.parent,
      path: f.path,
      m,
      own: null,
      abs: mul(parentAbs, m),
      inNon: f.inNon,
    });
    const id = f.el.getAttribute('id');
    if (id !== null && id !== '') {
      idCount.set(id, (idCount.get(id) ?? 0) + 1);
      if (!byId.has(id)) byId.set(id, idx);
    }
    const kids = f.el.children;
    const counts = new Map<string, number>();
    const frames: Array<{ el: Element; parent: number; path: string; inNon: boolean }> = [];
    const inNon = f.inNon || NON_BINDABLE_CONTAINER.has(f.el.localName);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const n = (counts.get(k.localName) ?? 0) + 1;
      counts.set(k.localName, n);
      frames.push({ el: k, parent: idx, path: `${f.path}/${k.localName}[${n}]`, inNon });
    }
    for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]);
  }
  // 2. hộp bao: từ lá lên (duyệt ngược tiền thứ tự = con trước cha); hai lượt để `use` thấy đích
  const localBox: Array<Box | null> = new Array<Box | null>(recs.length).fill(null);
  for (let pass = 0; pass < 2; pass++) {
    localBox.fill(null);
    for (let i = recs.length - 1; i >= 0; i--) {
      const r = recs[i];
      const tag = r.el.localName;
      let local: Box | null = localBox[i]; // hợp hộp con đã dồn lên
      if (tag === 'use') {
        const href = r.el.getAttribute('href');
        const t = href !== null && href.charCodeAt(0) === 35 ? byId.get(href.slice(1)) : undefined;
        const tb = t !== undefined && t !== i ? recs[t].own : null;
        local = tb ? [tb[0] + num(r.el, 'x'), tb[1] + num(r.el, 'y'), tb[2] + num(r.el, 'x'), tb[3] + num(r.el, 'y')] : (() => {
          const x = num(r.el, 'x');
          const y = num(r.el, 'y');
          return [x, y, x, y] as Box;
        })();
      } else if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch') {
        // local đã là hợp hộp của các con
      } else if (tag === 'defs' || NON_BINDABLE_CONTAINER.has(tag)) {
        local = null; // nội dung định nghĩa không vẽ trực tiếp
      } else {
        local = shapeBox(r.el);
      }
      r.own = local ? boxOfMatrix(r.m, local) : null;
      if (r.own && r.parent >= 0 && !NON_BINDABLE_CONTAINER.has(tag) && tag !== 'tspan' && tag !== 'title') {
        // dồn lên cha trừ khi cha là vùng định nghĩa (đã loại ở trên khi cha xử lý)
        localBox[r.parent] = unionInto(localBox[r.parent], r.own);
      }
    }
  }
  // 3. mục chữ ký của phần tử gắn được
  const items: SigItem[] = [];
  const itemOf = new Array<number>(recs.length).fill(-1);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.inNon || !isBindable(r.el)) continue;
    const style: Record<string, string> = {};
    for (const a of STYLE_ATTRS) {
      const v = r.el.getAttribute(a);
      if (v !== null) style[a] = v.trim();
    }
    // tổ tiên gắn được gần nhất
    let p = r.parent;
    while (p >= 0 && itemOf[p] < 0) p = recs[p].parent;
    const parentAbs = r.parent >= 0 ? recs[r.parent].abs : base;
    let kids = 0;
    const ch = r.el.children;
    for (let k = 0; k < ch.length; k++) if (isBindable(ch[k])) kids++;
    itemOf[i] = items.length;
    items.push({
      el: r.el,
      path: r.path,
      tag: r.el.localName,
      id: r.el.getAttribute('id'),
      uid: r.el.getAttribute('data-mat-uid'),
      style,
      box: r.own ? boxOfMatrix(parentAbs, r.own) : null,
      kids,
      parent: p >= 0 ? itemOf[p] : -1,
    });
  }
  return { items, viewBox: mapTo ?? viewBox, diag: Math.hypot((mapTo ?? viewBox)[2], (mapTo ?? viewBox)[3]), idCount };
}

/** Khoảng cách D (contract §7): Chebyshev của hộp bao chuẩn hóa theo `diag`, cộng phạt thuộc tính trình bày. */
export function distance(a: SigItem, b: SigItem, diag: number): number {
  if (a.tag !== b.tag) return Infinity;
  let geo: number;
  if (a.box === null || b.box === null) {
    if (a.box !== b.box) return Infinity;
    geo = 0;
  } else {
    geo =
      Math.max(
        Math.abs(a.box[0] - b.box[0]),
        Math.abs(a.box[1] - b.box[1]),
        Math.abs(a.box[2] - b.box[2]),
        Math.abs(a.box[3] - b.box[3]),
      ) / diag;
  }
  let diff = 0;
  for (const k of STYLE_ATTRS) if (a.style[k] !== b.style[k]) diff++;
  return geo + Math.min(STYLE_PENALTY_CAP, STYLE_PENALTY * diff);
}

/** Danh sách (phần tử gắn được, đường dẫn) theo thứ tự tài liệu, không tính hộp bao. */
export function bindablePaths(root: Element): Array<{ el: Element; path: string }> {
  const out: Array<{ el: Element; path: string }> = [];
  const stack: Array<{ el: Element; path: string; inNon: boolean }> = [{ el: root, path: '/svg', inNon: false }];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (!f.inNon && isBindable(f.el)) out.push({ el: f.el, path: f.path });
    const inNon = f.inNon || NON_BINDABLE_CONTAINER.has(f.el.localName);
    const kids = f.el.children;
    const counts = new Map<string, number>();
    const frames: Array<{ el: Element; path: string; inNon: boolean }> = [];
    for (let i = 0; i < kids.length; i++) {
      const n = (counts.get(kids[i].localName) ?? 0) + 1;
      counts.set(kids[i].localName, n);
      frames.push({ el: kids[i], path: `${f.path}/${kids[i].localName}[${n}]`, inNon });
    }
    for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]);
  }
  return out;
}
