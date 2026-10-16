// Ma trận affine 2D `[a b c d e f]` như SVG (contracts/svg-editor.md §4): x' = a·x + c·y + e, y' = b·x + d·y + f.
// Nhân và kiểu dùng lại của @mat/svg-renderer (transform-parse.ts); file này thêm nghịch đảo, phân tích, so sánh.
import { IDENTITY_MATRIX, multiplyMatrix, type Matrix2D } from '@mat/svg-renderer';

export type Matrix = Matrix2D;
export interface Point {
  x: number;
  y: number;
}

export const IDENTITY: Matrix = [...IDENTITY_MATRIX] as Matrix;
export const EPS = 1e-9;

/** Tích M1·M2 (điểm đi qua M2 trước). */
export function multiply(m1: Readonly<Matrix>, m2: Readonly<Matrix>): Matrix {
  return multiplyMatrix(m1, m2);
}

/** Tích nhiều ma trận theo thứ tự (trái sang phải như danh sách `transform`). */
export function compose(...ms: ReadonlyArray<Readonly<Matrix>>): Matrix {
  let r: Matrix = [...IDENTITY];
  for (const m of ms) r = multiply(r, m);
  return r;
}

export const det = (m: Readonly<Matrix>): number => m[0] * m[3] - m[1] * m[2];

export function invert(m: Readonly<Matrix>): Matrix | null {
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const [a, b, c, dd, e, f] = m;
  return [dd / d, -b / d, -c / d, a / d, (c * f - dd * e) / d, (b * e - a * f) / d];
}

export function applyPoint(m: Readonly<Matrix>, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export const translateM = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];

export function scaleM(sx: number, sy: number, cx = 0, cy = 0): Matrix {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

const RAD = Math.PI / 180;

/** Xoay `deg` độ quanh (cx, cy); bội 90° cho giá trị đúng (không sai số sin/cos). */
export function rotateM(deg: number, cx = 0, cy = 0): Matrix {
  const k = ((deg % 360) + 360) % 360;
  let cos: number;
  let sin: number;
  if (k === 0) [cos, sin] = [1, 0];
  else if (k === 90) [cos, sin] = [0, 1];
  else if (k === 180) [cos, sin] = [-1, 0];
  else if (k === 270) [cos, sin] = [0, -1];
  else [cos, sin] = [Math.cos(deg * RAD), Math.sin(deg * RAD)];
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

export const skewXM = (deg: number): Matrix => [1, 0, Math.tan(deg * RAD), 1, 0, 0];
export const skewYM = (deg: number): Matrix => [1, Math.tan(deg * RAD), 0, 1, 0, 0];

/** Có nghiêng: hai cột (a,b) và (c,d) không vuông góc (c·a + d·b ≠ 0, tương đối). */
export function hasSkew(m: Readonly<Matrix>, eps = 1e-9): boolean {
  const n = Math.hypot(m[0], m[1]) * Math.hypot(m[2], m[3]);
  if (n === 0) return true;
  return Math.abs(m[0] * m[2] + m[1] * m[3]) / n > eps;
}

/**
 * Phân tích M = T(tx,ty)·R(angle)·S(sx,sy) (không nghiêng). `sy` âm khi lật. Với ma trận có nghiêng, kết quả chỉ là
 * xấp xỉ (dùng `hasSkew` trước).
 */
export function decompose(m: Readonly<Matrix>): {
  tx: number;
  ty: number;
  angle: number;
  sx: number;
  sy: number;
} {
  const sx = Math.hypot(m[0], m[1]);
  const angle = Math.atan2(m[1], m[0]) / RAD;
  const sy = sx === 0 ? 0 : det(m) / sx;
  return { tx: m[4], ty: m[5], angle, sx, sy };
}

export function matrixEquals(a: Readonly<Matrix>, b: Readonly<Matrix>, eps = 1e-9): boolean {
  for (let i = 0; i < 6; i++) {
    const tol = eps * Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

export const isIdentity = (m: Readonly<Matrix>, eps = 1e-9): boolean =>
  matrixEquals(m, IDENTITY, eps);
