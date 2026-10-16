// Di chuyển, đổi cỡ, xoay (contracts/svg-editor.md §4; FR-100; research R25). Phép `T` trong hệ tài liệu được quy về
// hệ của cha: L = CTM(cha)⁻¹ · T · CTM(cha); transform mới M' = L · M. Khi K = M⁻¹ · L · M "chính xác" cho loại hình
// (không nghiêng, det > 0; xoay chỉ bội 90° với rect/ellipse/circle không tròn), K được bake vào thuộc tính hình học và
// `transform` giữ nguyên; ngược lại ghi `transform` = M'. `circle` co không đều thành `ellipse` (giữ uid, id, thứ tự).
import { buildSubtree, specOf, type NodeSpec } from './build.ts';
import { plainNumber } from './bbox.ts';
import { Batch, InsertNode, RemoveNode, SetAttr, type Command } from './command.ts';
import {
  applyPoint,
  decompose,
  det,
  hasSkew,
  invert,
  isIdentity,
  multiply,
  rotateM,
  scaleM,
  translateM,
  type Matrix,
} from './matrix.ts';
import type { DrawDoc, DrawNode, NodeId } from './node.ts';
import { isAncestorOrSelf } from './node.ts';
import { formatPoints, parsePoints } from './path.ts';
import { fmt, parentCtm, serializeTransform, transformOf } from './transform.ts';

export interface TransformResult {
  batch: Batch;
  /** Nút bị thay (circle → ellipse): mã cũ → mã mới. */
  replaced: Map<NodeId, NodeId>;
}

const BAKE_TAGS: ReadonlySet<string> = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
]);

/** Góc của K là bội 90°: trả true nếu đổi vai trục (90°, 270°). null nếu không phải bội 90°. */
function quarterTurn(k: Matrix): boolean | null {
  const s = Math.hypot(k[0], k[1]);
  if (Math.abs(k[1]) <= 1e-9 * s) return false;
  if (Math.abs(k[0]) <= 1e-9 * s) return true;
  return null;
}

/** Giá trị số thuần của các thuộc tính (thiếu: mặc định); null nếu có thuộc tính dùng đơn vị. */
function nums(
  n: DrawNode,
  names: readonly string[],
  defaults: Record<string, number> = {},
): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const k of names) {
    const v = n.attrs.get(k);
    if (v === undefined) {
      out[k] = defaults[k] ?? 0;
      continue;
    }
    const x = plainNumber(v);
    if (x === null) return null;
    out[k] = x;
  }
  return out;
}

type BakeResult = { attrs: Array<[string, string | null]>; tag?: 'ellipse' } | null;

/** Thuộc tính hình học mới khi bake K; null khi không chính xác. */
function bakeAttrs(n: DrawNode, k: Matrix): BakeResult {
  if (!BAKE_TAGS.has(n.tag) || hasSkew(k) || det(k) <= 1e-12) return null;
  const { sx, sy } = decompose(k);
  const uniform = Math.abs(sx - sy) <= 1e-9 * Math.max(1, sx);
  const turn = quarterTurn(k);
  switch (n.tag) {
    case 'rect': {
      if (turn === null) return null;
      const g = nums(n, ['x', 'y', 'width', 'height']);
      if (!g) return null;
      const hasRx = n.attrs.has('rx');
      const hasRy = n.attrs.has('ry');
      const r = nums(n, ['rx', 'ry']);
      if (!r) return null;
      const a = applyPoint(k, { x: g.x, y: g.y });
      const b = applyPoint(k, { x: g.x + g.width, y: g.y + g.height });
      const out: Array<[string, string | null]> = [
        ['x', fmt(Math.min(a.x, b.x))],
        ['y', fmt(Math.min(a.y, b.y))],
        ['width', fmt(Math.abs(b.x - a.x))],
        ['height', fmt(Math.abs(b.y - a.y))],
      ];
      if (hasRx || hasRy) {
        const rx = hasRx ? r.rx : r.ry;
        const ry = hasRy ? r.ry : r.rx;
        const nrx = turn ? ry * sy : rx * sx;
        const nry = turn ? rx * sx : ry * sy;
        if (hasRx || Math.abs(nrx - nry) > 1e-9) out.push(['rx', fmt(nrx)]);
        if (hasRy || Math.abs(nrx - nry) > 1e-9) out.push(['ry', fmt(nry)]);
      }
      return { attrs: out };
    }
    case 'circle': {
      const g = nums(n, ['cx', 'cy', 'r']);
      if (!g) return null;
      const c = applyPoint(k, { x: g.cx, y: g.cy });
      if (uniform)
        return {
          attrs: [
            ['cx', fmt(c.x)],
            ['cy', fmt(c.y)],
            ['r', fmt(g.r * sx)],
          ],
        };
      if (turn === null) return null;
      return {
        tag: 'ellipse',
        attrs: [
          ['cx', fmt(c.x)],
          ['cy', fmt(c.y)],
          ['rx', fmt(g.r * (turn ? sy : sx))],
          ['ry', fmt(g.r * (turn ? sx : sy))],
        ],
      };
    }
    case 'ellipse': {
      const g = nums(n, ['cx', 'cy', 'rx', 'ry']);
      if (!g) return null;
      const round = Math.abs(g.rx - g.ry) <= 1e-12 && uniform;
      if (turn === null && !round) return null;
      const c = applyPoint(k, { x: g.cx, y: g.cy });
      const sw = turn === true;
      return {
        attrs: [
          ['cx', fmt(c.x)],
          ['cy', fmt(c.y)],
          ['rx', fmt(sw ? g.ry * sy : g.rx * sx)],
          ['ry', fmt(sw ? g.rx * sx : g.ry * sy)],
        ],
      };
    }
    case 'line': {
      const g = nums(n, ['x1', 'y1', 'x2', 'y2']);
      if (!g) return null;
      const p = applyPoint(k, { x: g.x1, y: g.y1 });
      const q = applyPoint(k, { x: g.x2, y: g.y2 });
      return {
        attrs: [
          ['x1', fmt(p.x)],
          ['y1', fmt(p.y)],
          ['x2', fmt(q.x)],
          ['y2', fmt(q.y)],
        ],
      };
    }
    default: {
      const pts = parsePoints(n.attrs.get('points') ?? '');
      if (!pts) return null;
      const out = pts.map((p) => {
        const r = applyPoint(k, { x: p[0], y: p[1] });
        return [r.x, r.y] as [number, number];
      });
      return { attrs: [['points', formatPoints(out)]] };
    }
  }
}

/**
 * Lệnh áp phép `L` (trong hệ của cha) cho nút: bake khi chính xác, ngược lại ghi transform. Trả lệnh và (khi
 * circle thành ellipse) mã nút mới.
 */
export function applyLocal(
  doc: DrawDoc,
  id: NodeId,
  L: Matrix,
  opts: { noReplace?: boolean } = {},
): { commands: Command[]; replacedBy?: NodeId } {
  const n = doc.nodes.get(id)!;
  if (id === doc.root || isIdentity(L)) return { commands: [] };
  const M = transformOf(doc, id);
  const Mi = invert(M);
  const K = Mi ? multiply(multiply(Mi, L), M) : null;
  const baked = K ? bakeAttrs(n, K) : null;
  if (baked && !baked.tag) {
    const cmds: Command[] = [];
    for (const [k, v] of baked.attrs) if (n.attrs.get(k) !== v) cmds.push(new SetAttr(id, k, v));
    return { commands: cmds };
  }
  if (baked && baked.tag === 'ellipse' && !opts.noReplace) {
    // circle → ellipse: thay nút, giữ thứ tự thuộc tính (r thành rx, ry) và con (title)
    const values = new Map(baked.attrs);
    const attrs: Array<[string, string]> = [];
    for (const [k, v] of n.attrs) {
      if (k === 'r') {
        attrs.push(['rx', values.get('rx')!], ['ry', values.get('ry')!]);
      } else attrs.push([k, values.has(k) ? values.get(k)! : v]);
    }
    for (const k of ['cx', 'cy', 'rx', 'ry'])
      if (!attrs.some(([a]) => a === k)) attrs.push([k, values.get(k)!]);
    const spec: NodeSpec = {
      tag: 'ellipse',
      attrs,
      children: n.children.map((c) => specOf(doc, c)),
    };
    const p = doc.nodes.get(n.parent!)!;
    const sub = buildSubtree(doc, spec);
    return {
      commands: [new RemoveNode(id), new InsertNode(p.id, p.children.indexOf(id), sub)],
      replacedBy: sub.root,
    };
  }
  const t = serializeTransform(multiply(L, M));
  return { commands: [new SetAttr(id, 'transform', t === '' ? null : t)] };
}

/** Bỏ gốc, nút trùng và nút con của nút khác trong vùng chọn. */
export function topLevel(doc: DrawDoc, ids: readonly NodeId[]): NodeId[] {
  const set = [...new Set(ids)].filter((id) => id !== doc.root && doc.nodes.has(id));
  return set.filter((id) => !set.some((o) => o !== id && isAncestorOrSelf(doc, o, id)));
}

/** Áp phép `T` (hệ tài liệu) cho các nút; một lô. */
export function transformNodes(
  doc: DrawDoc,
  ids: readonly NodeId[],
  T: Matrix,
  label = 'Biến đổi',
): TransformResult {
  const cmds: Command[] = [];
  const replaced = new Map<NodeId, NodeId>();
  for (const id of topLevel(doc, ids)) {
    const P = parentCtm(doc, id);
    const Pi = invert(P);
    if (!Pi) continue;
    const r = applyLocal(doc, id, multiply(multiply(Pi, T), P));
    cmds.push(...r.commands);
    if (r.replacedBy !== undefined) replaced.set(id, r.replacedBy);
  }
  return { batch: new Batch(cmds, { label }), replaced };
}

export const moveNodes = (
  doc: DrawDoc,
  ids: readonly NodeId[],
  dx: number,
  dy: number,
): TransformResult => transformNodes(doc, ids, translateM(dx, dy), 'Di chuyển');

export const scaleNodes = (
  doc: DrawDoc,
  ids: readonly NodeId[],
  sx: number,
  sy: number,
  ox: number,
  oy: number,
): TransformResult => transformNodes(doc, ids, scaleM(sx, sy, ox, oy), 'Đổi cỡ');

export const rotateNodes = (
  doc: DrawDoc,
  ids: readonly NodeId[],
  deg: number,
  cx: number,
  cy: number,
): TransformResult => transformNodes(doc, ids, rotateM(deg, cx, cy), 'Xoay');
