// Sửa nút (contracts/svg-editor.md §8 công cụ N; FR-107): đa tuyến, đa giác, và `path` chỉ gồm M L H V Z. Điểm trao
// đổi với giao diện trong hệ tài liệu; lệnh ghi trong hệ của phần tử (qua CTM⁻¹). `path` có đường cong bị khóa kèm lý do.
import { buildSubtree, specOf } from './build.ts';
import { Batch, CommandError, InsertNode, RemoveNode, SetAttr, type Command } from './command.ts';
import { applyPoint, invert, type Point } from './matrix.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { formatPoints, parsePoints, pathToPolys, polysToPath, type Poly } from './path.ts';
import { ctm } from './transform.ts';

export type EditablePoints =
  | { ok: true; points: Point[]; closed: boolean; kind: 'polyline' | 'polygon' | 'path' }
  | { ok: false; reason: string };

/** Đường con theo chỉ số phẳng. */
function polysOf(
  doc: DrawDoc,
  id: NodeId,
): { polys: Poly[]; kind: 'polyline' | 'polygon' | 'path' } | string {
  const n = doc.nodes.get(id);
  if (!n) return 'không có phần tử';
  if (n.tag === 'polyline' || n.tag === 'polygon') {
    const pts = parsePoints(n.attrs.get('points') ?? '');
    if (!pts) return 'danh sách điểm hỏng';
    return { polys: [{ points: pts, closed: n.tag === 'polygon' }], kind: n.tag };
  }
  if (n.tag === 'path') {
    const polys = pathToPolys(n.attrs.get('d') ?? '');
    if (!polys) return 'đường có đoạn cong (C, S, Q, T, A): chỉ di chuyển, đổi cỡ, xoay, đổi màu';
    return { polys, kind: 'path' };
  }
  return `<${n.tag}> không có nút để sửa`;
}

export function editablePoints(doc: DrawDoc, id: NodeId): EditablePoints {
  const r = polysOf(doc, id);
  if (typeof r === 'string') return { ok: false, reason: r };
  const m = ctm(doc, id);
  const points: Point[] = [];
  for (const p of r.polys)
    for (const q of p.points) points.push(applyPoint(m, { x: q[0], y: q[1] }));
  return { ok: true, points, closed: r.polys.length > 0 && r.polys[0].closed, kind: r.kind };
}

function locate(polys: Poly[], i: number): [number, number] {
  let k = i;
  for (let s = 0; s < polys.length; s++) {
    if (k < polys[s].points.length) return [s, k];
    k -= polys[s].points.length;
  }
  throw new CommandError('SVG_INVALID', `Không có điểm ${i}`);
}

function toLocal(doc: DrawDoc, id: NodeId, p: Point): [number, number] {
  const mi = invert(ctm(doc, id));
  if (!mi) throw new CommandError('SVG_INVALID', 'Ma trận suy biến');
  const q = applyPoint(mi, p);
  return [q.x, q.y];
}

function write(id: NodeId, kind: string, polys: Poly[]): Command {
  return kind === 'path'
    ? new SetAttr(id, 'd', polysToPath(polys))
    : new SetAttr(id, 'points', formatPoints(polys[0].points));
}

function editable(
  doc: DrawDoc,
  id: NodeId,
): { polys: Poly[]; kind: 'polyline' | 'polygon' | 'path' } {
  const r = polysOf(doc, id);
  if (typeof r === 'string') throw new CommandError('SVG_INVALID', r);
  return r;
}

/** Đặt điểm `i` (chỉ số phẳng) tới `p` (hệ tài liệu). */
export function setPoint(doc: DrawDoc, id: NodeId, i: number, p: Point): Command {
  const { polys, kind } = editable(doc, id);
  const [s, k] = locate(polys, i);
  polys[s].points[k] = toLocal(doc, id, p);
  const c = write(id, kind, polys);
  c.mergeKey = `node:${id}:${i}`;
  return c;
}

/** Thêm điểm sau chỉ số `after`. */
export function insertPoint(doc: DrawDoc, id: NodeId, after: number, p: Point): Command {
  const { polys, kind } = editable(doc, id);
  const [s, k] = locate(polys, after);
  polys[s].points.splice(k + 1, 0, toLocal(doc, id, p));
  return write(id, kind, polys);
}

/** Xóa điểm (giữ tối thiểu 2 điểm cho đường mở, 3 cho đường đóng). */
export function deletePoint(doc: DrawDoc, id: NodeId, i: number): Command {
  const { polys, kind } = editable(doc, id);
  const [s, k] = locate(polys, i);
  const min = polys[s].closed ? 3 : 2;
  if (polys[s].points.length <= min)
    throw new CommandError('SVG_INVALID', `Cần ít nhất ${min} điểm`);
  polys[s].points.splice(k, 1);
  return write(id, kind, polys);
}

/** Đóng/mở: polyline ↔ polygon (thay nút, giữ uid, thuộc tính, con); path thêm/bỏ Z ở mọi đường con. */
export function setClosed(doc: DrawDoc, id: NodeId, closed: boolean): { batch: Batch; id: NodeId } {
  const { polys, kind } = editable(doc, id);
  if (kind === 'path') {
    for (const p of polys) p.closed = closed;
    return {
      batch: new Batch([write(id, kind, polys)], { label: closed ? 'Đóng đường' : 'Mở đường' }),
      id,
    };
  }
  if ((kind === 'polygon') === closed) return { batch: new Batch([]), id };
  const n = doc.nodes.get(id)!;
  const p = doc.nodes.get(n.parent!)!;
  const spec = specOf(doc, id);
  const sub = buildSubtree(doc, { ...spec, tag: closed ? 'polygon' : 'polyline' });
  return {
    batch: new Batch([new RemoveNode(id), new InsertNode(p.id, p.children.indexOf(id), sub)], {
      label: closed ? 'Đóng đường' : 'Mở đường',
    }),
    id: sub.root,
  };
}

/** Cạnh gần điểm nhất (để thêm điểm khi nhấp đúp cạnh): chỉ số điểm đầu của cạnh và khoảng cách. */
export function nearestSegment(
  points: readonly Point[],
  p: Point,
  closed: boolean,
): { index: number; distance: number } {
  let best = { index: -1, distance: Infinity };
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best.distance) best = { index: i, distance: d };
  }
  return best;
}
