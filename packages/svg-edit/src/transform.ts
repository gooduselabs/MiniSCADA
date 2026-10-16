// `transform` của nút và ma trận tích lũy (contracts/svg-editor.md §4; FR-100). Phân tích dùng bộ của
// @mat/svg-renderer; ghi ưu tiên dạng ngắn (translate, scale, rotate, rotate quanh tâm, translate + scale) khi chính
// xác, ngược lại `matrix`. Số làm tròn tối đa 3 chữ số thập phân, bỏ số 0 thừa, `-0` thành `0`.
import { parseTransformMatrix } from '@mat/svg-renderer';
import { IDENTITY, multiply, type Matrix } from './matrix.ts';
import type { DrawDoc, NodeId } from './node.ts';

/** Định dạng số khi ghi (§4). */
export function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  if (r === 0 || !Number.isFinite(r)) return '0';
  return String(r);
}

/** Ma trận của chuỗi `transform` (rỗng: đơn vị); null khi hỏng. */
export function parseTransformAttr(s: string): Matrix | null {
  return parseTransformMatrix(s);
}

const near = (a: number, b: number, eps = 1e-9): boolean =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** Chuỗi `transform` của ma trận ('' cho đơn vị). */
export function serializeTransform(m: Readonly<Matrix>): string {
  const [a, b, c, d, e, f] = m;
  const noTrans = near(e, 0) && near(f, 0);
  if (near(b, 0) && near(c, 0)) {
    const unit = near(a, 1) && near(d, 1);
    if (unit) return noTrans ? '' : `translate(${fmt(e)} ${fmt(f)})`;
    const sc = near(a, d) ? `scale(${fmt(a)})` : `scale(${fmt(a)} ${fmt(d)})`;
    return noTrans ? sc : `translate(${fmt(e)} ${fmt(f)}) ${sc}`;
  }
  if (near(a, d) && near(b, -c) && near(a * a + b * b, 1)) {
    const deg = (Math.atan2(b, a) * 180) / Math.PI;
    if (noTrans) return `rotate(${fmt(deg)})`;
    const k = 2 - 2 * a;
    if (k > 1e-12) {
      const cx = ((1 - a) * e - b * f) / k;
      const cy = (b * e + (1 - a) * f) / k;
      return `rotate(${fmt(deg)} ${fmt(cx)} ${fmt(cy)})`;
    }
  }
  return `matrix(${m.map(fmt).join(' ')})`;
}

/** Ma trận `transform` của chính nút (đơn vị khi không có hoặc hỏng). */
export function transformOf(doc: DrawDoc, id: NodeId): Matrix {
  const n = doc.nodes.get(id)!;
  if (id === doc.root) return [...IDENTITY];
  const t = n.attrs.get('transform');
  return (t !== undefined ? parseTransformAttr(t) : null) ?? [...IDENTITY];
}

/**
 * Ma trận tích lũy từ hệ tài liệu (hệ người dùng của gốc) tới hệ của nút, gồm `transform` của chính nút. `svg` lồng:
 * cộng dịch `x`, `y` của nó cho con.
 */
export function ctm(doc: DrawDoc, id: NodeId): Matrix {
  const chain: NodeId[] = [];
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent) chain.push(cur);
  let m: Matrix = [...IDENTITY];
  for (let i = chain.length - 1; i >= 0; i--) {
    const nid = chain[i];
    m = multiply(m, transformOf(doc, nid));
    const n = doc.nodes.get(nid)!;
    if (n.tag === 'svg' && nid !== doc.root && i > 0) {
      const x = Number(n.attrs.get('x') ?? 0) || 0;
      const y = Number(n.attrs.get('y') ?? 0) || 0;
      m = multiply(m, [1, 0, 0, 1, x, y]);
    }
  }
  return m;
}

/** Ma trận tích lũy của cha (hệ mà `transform` của nút sống trong đó). */
export function parentCtm(doc: DrawDoc, id: NodeId): Matrix {
  const p = doc.nodes.get(id)!.parent;
  return p === null ? [...IDENTITY] : ctm(doc, p);
}
