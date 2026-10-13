// Bộ phân tích thuộc tính `transform` của SVG, dùng chung cho allowlist (isTransform), DomApplier
// (ma trận cơ sở M0, ADR-024, research R9) và đối chiếu nhập lại (R17). Không biểu thức chính quy,
// không dùng layout hay DOM: chỉ chuỗi vào, danh sách phép biến đổi và ma trận ra.

import { isAsciiLetter, scanNumber, skipWs } from './scan.ts';

/** Ma trận 2x3 [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (như SVG). */
export type Matrix2D = [number, number, number, number, number, number];

export type TransformOp =
  | { type: 'matrix'; values: Matrix2D }
  | { type: 'translate'; tx: number; ty: number }
  | { type: 'scale'; sx: number; sy: number }
  | { type: 'rotate'; angle: number; cx: number; cy: number }
  | { type: 'skewX'; angle: number }
  | { type: 'skewY'; angle: number };

export const IDENTITY_MATRIX: Readonly<Matrix2D> = Object.freeze([1, 0, 0, 1, 0, 0]) as Matrix2D;

/** Tích M1·M2: điểm đi qua M2 trước rồi M1 (đúng thứ tự danh sách `transform` của SVG). */
export function multiplyMatrix(m1: Readonly<Matrix2D>, m2: Readonly<Matrix2D>): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const RAD = Math.PI / 180;

/** Ma trận của một phép biến đổi. */
export function opToMatrix(op: TransformOp): Matrix2D {
  switch (op.type) {
    case 'matrix':
      return [...op.values];
    case 'translate':
      return [1, 0, 0, 1, op.tx, op.ty];
    case 'scale':
      return [op.sx, 0, 0, op.sy, 0, 0];
    case 'rotate': {
      const cos = Math.cos(op.angle * RAD);
      const sin = Math.sin(op.angle * RAD);
      const r: Matrix2D = [cos, sin, -sin, cos, 0, 0];
      if (op.cx === 0 && op.cy === 0) return r;
      return multiplyMatrix(multiplyMatrix([1, 0, 0, 1, op.cx, op.cy], r), [
        1,
        0,
        0,
        1,
        -op.cx,
        -op.cy,
      ]);
    }
    case 'skewX':
      return [1, 0, Math.tan(op.angle * RAD), 1, 0, 0];
    case 'skewY':
      return [1, Math.tan(op.angle * RAD), 0, 1, 0, 0];
  }
}

/** Ma trận hợp M1·M2·…·Mn của danh sách phép biến đổi (rỗng: ma trận đơn vị). */
export function opsToMatrix(ops: readonly TransformOp[]): Matrix2D {
  let m: Matrix2D = [...IDENTITY_MATRIX];
  for (const op of ops) m = multiplyMatrix(m, opToMatrix(op));
  return m;
}

function nameAt(s: string, i: number): string {
  let j = i;
  while (j < s.length && isAsciiLetter(s.charCodeAt(j))) j++;
  return s.slice(i, j);
}

/** Quét danh sách đối số trong ngoặc; `i` trỏ ngay sau `(`. Trả đối số và chỉ số sau `)`. */
function scanArgs(s: string, i: number): { args: number[]; end: number } | null {
  const args: number[] = [];
  i = skipWs(s, i);
  for (;;) {
    const n = scanNumber(s, i);
    if (!n) return null;
    args.push(n.value);
    if (args.length > 6) return null;
    i = skipWs(s, n.end);
    const c = s.charCodeAt(i);
    if (c === 41) return { args, end: i + 1 };
    if (c === 44) i = skipWs(s, i + 1);
    // phân cách bằng khoảng trắng: số kế tiếp bắt đầu tại i (scanNumber kiểm)
  }
}

/**
 * Phân tích chuỗi `transform`: danh sách `matrix`, `translate`, `scale`, `rotate`, `skewX`, `skewY`
 * với số thuần (không đơn vị). Trả `[]` cho chuỗi rỗng; `null` khi có hàm lạ, sai số đối số, số hỏng.
 */
export function parseTransform(s: string): TransformOp[] | null {
  const ops: TransformOp[] = [];
  let i = skipWs(s, 0);
  while (i < s.length) {
    const name = nameAt(s, i);
    if (name === '') return null;
    i = skipWs(s, i + name.length);
    if (s.charCodeAt(i) !== 40) return null;
    const parsed = scanArgs(s, i + 1);
    if (!parsed) return null;
    const a = parsed.args;
    switch (name) {
      case 'matrix':
        if (a.length !== 6) return null;
        ops.push({ type: 'matrix', values: [a[0], a[1], a[2], a[3], a[4], a[5]] });
        break;
      case 'translate':
        if (a.length !== 1 && a.length !== 2) return null;
        ops.push({ type: 'translate', tx: a[0], ty: a.length === 2 ? a[1] : 0 });
        break;
      case 'scale':
        if (a.length !== 1 && a.length !== 2) return null;
        ops.push({ type: 'scale', sx: a[0], sy: a.length === 2 ? a[1] : a[0] });
        break;
      case 'rotate':
        if (a.length !== 1 && a.length !== 3) return null;
        ops.push({
          type: 'rotate',
          angle: a[0],
          cx: a.length === 3 ? a[1] : 0,
          cy: a.length === 3 ? a[2] : 0,
        });
        break;
      case 'skewX':
      case 'skewY':
        if (a.length !== 1) return null;
        ops.push({ type: name, angle: a[0] });
        break;
      default:
        return null;
    }
    i = skipWs(s, parsed.end);
    if (i < s.length && s.charCodeAt(i) === 44) {
      i = skipWs(s, i + 1);
      if (i >= s.length) return null; // dấu phẩy treo
    }
  }
  return ops;
}

/** Ma trận hợp của chuỗi `transform`; chuỗi rỗng cho ma trận đơn vị; null khi không hợp lệ. */
export function parseTransformMatrix(s: string): Matrix2D | null {
  const ops = parseTransform(s);
  return ops === null ? null : opsToMatrix(ops);
}

export function isTransform(s: string): boolean {
  return parseTransform(s) !== null;
}
