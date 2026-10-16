// Hộp bao trong hệ tài liệu (contracts/svg-editor.md §4): hình cơ bản chính xác dưới mọi ma trận affine (đỉnh của
// rect, cực trị của ellipse/Bézier/cung sau biến đổi), nhóm là hợp các con, `use` theo đích. Văn bản: ước tính từ
// `font-size` và số ký tự khi không có hàm đo của trình duyệt (`measure`).
import { parseDeclarations, scanNumber } from '@mat/svg-renderer';
import { IDENTITY, applyPoint, det, multiply, type Matrix, type Point } from './matrix.ts';
import type { Box, DrawDoc, DrawNode, NodeId } from './node.ts';
import { DEFINITION_TAGS, TEXT_NODE, isElement, textOf } from './node.ts';
import { parsePath, parsePoints } from './path.ts';
import { ctm, transformOf } from './transform.ts';

export interface TextMetrics {
  width: number;
  ascent: number;
  descent: number;
}

export interface BBoxOptions {
  /** Nở theo nửa độ dày nét (khi có `stroke` khác none). */
  stroke?: boolean;
  /** Đo chữ (trình duyệt: canvas). Mặc định ước tính 0,6 × cỡ × số ký tự, cao = cỡ, đỉnh = y − 0,8 × cỡ. */
  measure?: (
    text: string,
    font: { size: number; family: string; weight: string; style: string },
  ) => TextMetrics;
}

const UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  pt: 4 / 3,
  pc: 16,
};

/** Độ dài SVG thành số (đơn vị tuyệt đối đổi ra px; `%` theo `ref`); null khi không đọc được. */
export function parseLength(v: string | undefined, ref = 0): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  const n = scanNumber(s, 0);
  if (!n) return null;
  const unit = s.slice(n.end).trim();
  if (unit === '%') return (n.value * ref) / 100;
  const k = UNITS[unit];
  return k === undefined ? null : n.value * k;
}

/** Số thuần (không đơn vị); null nếu có đơn vị hay hỏng. */
export function plainNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  const n = scanNumber(s, 0);
  return n && n.end === s.length ? n.value : null;
}

class Acc {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  add(p: Point): void {
    if (p.x < this.x0) this.x0 = p.x;
    if (p.y < this.y0) this.y0 = p.y;
    if (p.x > this.x1) this.x1 = p.x;
    if (p.y > this.y1) this.y1 = p.y;
  }
  addBox(b: Box | null): void {
    if (!b) return;
    this.add({ x: b.x, y: b.y });
    this.add({ x: b.x + b.width, y: b.y + b.height });
  }
  box(): Box | null {
    if (this.x0 > this.x1) return null;
    return { x: this.x0, y: this.y0, width: this.x1 - this.x0, height: this.y1 - this.y0 };
  }
}

export function unionBoxes(boxes: ReadonlyArray<Box | null>): Box | null {
  const a = new Acc();
  for (const b of boxes) a.addBox(b);
  return a.box();
}

/** Thuộc tính trình bày của nút: `style` thắng thuộc tính. */
export function presentation(n: DrawNode, prop: string): string | undefined {
  const st = n.attrs.get('style');
  if (st !== undefined) for (const d of parseDeclarations(st)) if (d.prop === prop) return d.value;
  return n.attrs.get(prop);
}

/** Giá trị kế thừa (từ nút lên gốc). */
export function inherited(doc: DrawDoc, id: NodeId, prop: string): string | undefined {
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent) {
    const v = presentation(doc.nodes.get(cur)!, prop);
    if (v !== undefined && v !== 'inherit') return v;
  }
  return undefined;
}

/** Hộp bao của elip (cx, cy, rx, ry) qua ma trận: chính xác. */
function ellipseInto(acc: Acc, m: Matrix, cx: number, cy: number, rx: number, ry: number): void {
  const c = applyPoint(m, { x: cx, y: cy });
  const hw = Math.hypot(m[0] * rx, m[2] * ry);
  const hh = Math.hypot(m[1] * rx, m[3] * ry);
  acc.add({ x: c.x - hw, y: c.y - hh });
  acc.add({ x: c.x + hw, y: c.y + hh });
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // nghiệm của đạo hàm bậc hai: a t² + b t + c = 0
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** Hộp bao đường `d` qua ma trận (Bézier biến đổi affine vẫn là Bézier; cung tính cực trị sau biến đổi). */
function pathInto(acc: Acc, m: Matrix, d: string): void {
  const p = parsePath(d);
  if (!p) return;
  let cur: Point = { x: 0, y: 0 };
  let start: Point = cur;
  for (const s of p.segs) {
    switch (s.cmd) {
      case 'M':
        cur = { x: s.x, y: s.y };
        start = cur;
        acc.add(applyPoint(m, cur));
        break;
      case 'L':
        cur = { x: s.x, y: s.y };
        acc.add(applyPoint(m, cur));
        break;
      case 'Z':
        cur = start;
        break;
      case 'Q':
      case 'C': {
        const P0 = applyPoint(m, cur);
        const pts =
          s.cmd === 'C'
            ? [
                P0,
                applyPoint(m, { x: s.x1, y: s.y1 }),
                applyPoint(m, { x: s.x2, y: s.y2 }),
                applyPoint(m, { x: s.x, y: s.y }),
              ]
            : (() => {
                // bậc hai thành bậc ba
                const q1 = applyPoint(m, { x: s.x1, y: s.y1 });
                const P3 = applyPoint(m, { x: s.x, y: s.y });
                return [
                  P0,
                  { x: P0.x + (2 / 3) * (q1.x - P0.x), y: P0.y + (2 / 3) * (q1.y - P0.y) },
                  { x: P3.x + (2 / 3) * (q1.x - P3.x), y: P3.y + (2 / 3) * (q1.y - P3.y) },
                  P3,
                ];
              })();
        acc.add(pts[3]);
        for (const t of cubicExtrema(pts[0].x, pts[1].x, pts[2].x, pts[3].x))
          acc.add({
            x: cubicAt(pts[0].x, pts[1].x, pts[2].x, pts[3].x, t),
            y: cubicAt(pts[0].y, pts[1].y, pts[2].y, pts[3].y, t),
          });
        for (const t of cubicExtrema(pts[0].y, pts[1].y, pts[2].y, pts[3].y))
          acc.add({
            x: cubicAt(pts[0].x, pts[1].x, pts[2].x, pts[3].x, t),
            y: cubicAt(pts[0].y, pts[1].y, pts[2].y, pts[3].y, t),
          });
        cur = { x: s.x, y: s.y };
        break;
      }
      case 'A':
        arcInto(acc, m, cur, s);
        cur = { x: s.x, y: s.y };
        break;
    }
  }
}

/** Cung (tham số điểm cuối, SVG F.6.5) qua ma trận: điểm đầu, cuối và cực trị trong khoảng quét. */
function arcInto(
  acc: Acc,
  m: Matrix,
  p0: Point,
  s: { rx: number; ry: number; rot: number; large: boolean; sweep: boolean; x: number; y: number },
): void {
  const p1 = { x: s.x, y: s.y };
  acc.add(applyPoint(m, p1));
  let rx = s.rx;
  let ry = s.ry;
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return; // đoạn thẳng
  const phi = (s.rot * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (s.large === s.sweep) co = -co;
  const cxp = (co * rx * y1) / ry;
  const cyp = (-co * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  else if (s.sweep && dt < 0) dt += 2 * Math.PI;
  // điểm trên cung: P(t) = M·(c + R(phi)·(rx cos t, ry sin t)) = O + U cos t + V sin t
  const O = applyPoint(m, { x: cx, y: cy });
  const U = { x: m[0] * rx * cos + m[2] * rx * sin, y: m[1] * rx * cos + m[3] * rx * sin };
  const V = { x: -m[0] * ry * sin + m[2] * ry * cos, y: -m[1] * ry * sin + m[3] * ry * cos };
  const at = (t: number): Point => ({
    x: O.x + U.x * Math.cos(t) + V.x * Math.sin(t),
    y: O.y + U.y * Math.cos(t) + V.y * Math.sin(t),
  });
  acc.add(at(t1));
  const inSweep = (t: number): boolean => {
    let k = (t - t1) / (2 * Math.PI);
    k -= Math.floor(k);
    const rel = k * 2 * Math.PI; // trong [0, 2π)
    return dt >= 0 ? rel <= dt : rel - 2 * Math.PI >= dt || rel === 0;
  };
  for (const base of [Math.atan2(V.x, U.x), Math.atan2(V.y, U.y)])
    for (const t of [base, base + Math.PI]) if (inSweep(t)) acc.add(at(t));
}

function rectInto(acc: Acc, m: Matrix, x: number, y: number, w: number, h: number): void {
  acc.add(applyPoint(m, { x, y }));
  acc.add(applyPoint(m, { x: x + w, y }));
  acc.add(applyPoint(m, { x, y: y + h }));
  acc.add(applyPoint(m, { x: x + w, y: y + h }));
}

function firstLength(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = scanNumber(v.trim(), 0);
  return n ? n.value : 0;
}

/** Cỡ chữ kế thừa (mặc định 16). */
export function fontSizeOf(doc: DrawDoc, id: NodeId): number {
  const v = inherited(doc, id, 'font-size');
  const n = parseLength(v ?? '16');
  return n !== null && n > 0 ? n : 16;
}

interface Ctx {
  doc: DrawDoc;
  opts: BBoxOptions;
  depth: number;
}

function strokeExpand(ctx: Ctx, id: NodeId, m: Matrix, acc: Acc): void {
  if (!ctx.opts.stroke) return;
  const s = inherited(ctx.doc, id, 'stroke');
  if (s === undefined || s === 'none') return;
  const w = parseLength(inherited(ctx.doc, id, 'stroke-width') ?? '1') ?? 1;
  const k = (w / 2) * Math.sqrt(Math.abs(det(m)));
  if (acc.x0 > acc.x1) return;
  acc.x0 -= k;
  acc.y0 -= k;
  acc.x1 += k;
  acc.y1 += k;
}

/** Hộp bao của nút `id` khi hệ của nó (đã gồm transform của nó) là `m`. */
function nodeInto(ctx: Ctx, id: NodeId, m: Matrix, acc: Acc): void {
  const doc = ctx.doc;
  const n = doc.nodes.get(id)!;
  if (!isElement(n) || ctx.depth > 64) return;
  if (presentation(n, 'display') === 'none') return;
  const vb = doc.viewBox;
  const L = (name: string, ref = 0): number => parseLength(n.attrs.get(name), ref) ?? 0;
  const own = new Acc();
  switch (n.tag) {
    case 'rect':
    case 'image':
      rectInto(
        own,
        m,
        L('x', vb.width),
        L('y', vb.height),
        L('width', vb.width),
        L('height', vb.height),
      );
      break;
    case 'circle': {
      const r = L('r', Math.hypot(vb.width, vb.height) / Math.SQRT2);
      ellipseInto(own, m, L('cx', vb.width), L('cy', vb.height), r, r);
      break;
    }
    case 'ellipse':
      ellipseInto(
        own,
        m,
        L('cx', vb.width),
        L('cy', vb.height),
        L('rx', vb.width),
        L('ry', vb.height),
      );
      break;
    case 'line':
      own.add(applyPoint(m, { x: L('x1', vb.width), y: L('y1', vb.height) }));
      own.add(applyPoint(m, { x: L('x2', vb.width), y: L('y2', vb.height) }));
      break;
    case 'polyline':
    case 'polygon':
      for (const p of parsePoints(n.attrs.get('points') ?? '') ?? [])
        own.add(applyPoint(m, { x: p[0], y: p[1] }));
      break;
    case 'path':
      pathInto(own, m, n.attrs.get('d') ?? '');
      break;
    case 'text':
    case 'tspan': {
      const text = textOf(doc, id);
      if (text !== '') {
        const size = fontSizeOf(doc, id);
        const font = {
          size,
          family: inherited(doc, id, 'font-family') ?? 'sans-serif',
          weight: inherited(doc, id, 'font-weight') ?? 'normal',
          style: inherited(doc, id, 'font-style') ?? 'normal',
        };
        const met = ctx.opts.measure
          ? ctx.opts.measure(text, font)
          : { width: 0.6 * size * [...text].length, ascent: 0.8 * size, descent: 0.2 * size };
        const x = firstLength(n.attrs.get('x'));
        const y = firstLength(n.attrs.get('y'));
        const anchor = inherited(doc, id, 'text-anchor') ?? 'start';
        const x0 = anchor === 'middle' ? x - met.width / 2 : anchor === 'end' ? x - met.width : x;
        rectInto(own, m, x0, y - met.ascent, met.width, met.ascent + met.descent);
      }
      for (const c of n.children) {
        const k = doc.nodes.get(c)!;
        if (k.tag === 'tspan')
          nodeInto({ ...ctx, depth: ctx.depth + 1 }, c, multiply(m, transformOf(doc, c)), acc);
      }
      break;
    }
    case 'svg':
      if (id !== doc.root) {
        rectInto(
          own,
          m,
          L('x', vb.width),
          L('y', vb.height),
          L('width', vb.width),
          L('height', vb.height),
        );
        break;
      }
    // gốc: như nhóm
    // falls through
    case 'g':
    case 'a':
      for (const c of n.children) {
        const k = doc.nodes.get(c)!;
        if (!isElement(k) || DEFINITION_TAGS.has(k.tag)) continue;
        nodeInto({ ...ctx, depth: ctx.depth + 1 }, c, multiply(m, transformOf(doc, c)), acc);
      }
      break;
    case 'use': {
      const href = (n.attrs.get('href') ?? n.attrs.get('xlink:href') ?? '').trim();
      if (!href.startsWith('#')) break;
      let target: NodeId | null = null;
      for (const o of doc.nodes.values())
        if (o.attrs.get('id') === href.slice(1)) {
          target = o.id;
          break;
        }
      if (target === null || target === id) break;
      const t = doc.nodes.get(target)!;
      let mm = multiply(m, [1, 0, 0, 1, L('x', vb.width), L('y', vb.height)]);
      if (t.tag === 'symbol') {
        const vbs = parsePoints(t.attrs.get('viewBox') ?? '');
        const w = parseLength(n.attrs.get('width'));
        const h = parseLength(n.attrs.get('height'));
        if (vbs && vbs.length === 2 && w !== null && h !== null && vbs[1][0] > 0 && vbs[1][1] > 0) {
          const s = Math.min(w / vbs[1][0], h / vbs[1][1]);
          const ox = (w - s * vbs[1][0]) / 2;
          const oy = (h - s * vbs[1][1]) / 2;
          mm = multiply(mm, [s, 0, 0, s, ox - s * vbs[0][0], oy - s * vbs[0][1]]);
        }
        for (const c of t.children) {
          const k = doc.nodes.get(c)!;
          if (!isElement(k) || DEFINITION_TAGS.has(k.tag)) continue;
          nodeInto({ ...ctx, depth: ctx.depth + 8 }, c, multiply(mm, transformOf(doc, c)), acc);
        }
      } else
        nodeInto(
          { ...ctx, depth: ctx.depth + 8 },
          target,
          multiply(mm, transformOf(doc, target)),
          acc,
        );
      break;
    }
    default:
      break;
  }
  strokeExpand(ctx, id, m, own);
  acc.addBox(own.box());
}

/** Hộp bao của phần tử trong hệ tài liệu (gồm transform của nó và tổ tiên); null nếu không vẽ gì. */
export function bbox(doc: DrawDoc, id: NodeId, opts: BBoxOptions = {}): Box | null {
  const n = doc.nodes.get(id);
  if (!n || !isElement(n) || n.tag === TEXT_NODE) return null;
  if (DEFINITION_TAGS.has(n.tag)) return null;
  const acc = new Acc();
  nodeInto({ doc, opts, depth: 0 }, id, id === doc.root ? [...IDENTITY] : ctm(doc, id), acc);
  return acc.box();
}

/** Hộp bao trong hệ của cha (không gồm tổ tiên): để chuyển kết quả căn chỉnh về hệ cha. */
export function localBBox(doc: DrawDoc, id: NodeId, opts: BBoxOptions = {}): Box | null {
  const acc = new Acc();
  nodeInto({ doc, opts, depth: 0 }, id, transformOf(doc, id), acc);
  return acc.box();
}

/** Hộp bao của nhiều phần tử (hợp). */
export function selectionBBox(
  doc: DrawDoc,
  ids: readonly NodeId[],
  opts: BBoxOptions = {},
): Box | null {
  return unionBoxes(ids.map((id) => bbox(doc, id, opts)));
}
