// Trạng thái hợp biến đổi của một phần tử (ADR-024, research R9, contract binding-animation §3): hàm thuần,
// không đụng DOM. Chuỗi CSS dùng đơn vị px và deg (CSS `transform` bắt buộc; `matrix()` không đơn vị).
import { IDENTITY_MATRIX, parseTransformMatrix, type Matrix2D } from '@mat/svg-renderer';
import type { Box } from './clip-level.ts';

export type Pivot = [number, number];

export interface TransformState {
  /** Ma trận của thuộc tính `transform` gốc (đơn vị nếu không có). */
  m0: Matrix2D;
  /** Hộp bao cục bộ; null = chưa đo được (bỏ đoạn quay, co giãn). */
  bbox: Box | null;
  /** Dời ở đơn vị nhóm cha; null = không có binding dời. */
  translate: { x: number; y: number } | null;
  rotate: { angle: number; pivot: Pivot } | null;
  scale: { sx: number; sy: number; pivot: Pivot } | null;
}

/** `M0` từ thuộc tính `transform` gốc; thiếu hoặc không hợp lệ: ma trận đơn vị. */
export function readM0(attr: string | null | undefined): Matrix2D {
  if (!attr) return [...IDENTITY_MATRIX];
  return parseTransformMatrix(attr) ?? [...IDENTITY_MATRIX];
}

export function scaleFactors(
  s: number,
  axis: 'xy' | 'x' | 'y' | undefined,
): { sx: number; sy: number } {
  if (axis === 'x') return { sx: s, sy: 1 };
  if (axis === 'y') return { sx: 1, sy: s };
  return { sx: s, sy: s };
}

const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6 || 0);
const px = (n: number): string => `${fmt(n)}px`;

function around(box: Box, pivot: Pivot): { cx: number; cy: number } {
  return { cx: box.x + pivot[0] * box.width, cy: box.y + pivot[1] * box.height };
}

/**
 * `translate(tx,ty) matrix(M0) translate(c) rotate(r) translate(-c) translate(c') scale(sx,sy) translate(-c')`,
 * bỏ đoạn không dùng. `rotation` thay góc quay (vd `360deg` cho khung hình cuối của spin).
 */
export function buildTransform(s: TransformState, rotation?: string): string {
  const parts: string[] = [];
  if (s.translate) parts.push(`translate(${px(s.translate.x)}, ${px(s.translate.y)})`);
  const m = s.m0;
  const identity = m.every((v, i) => v === IDENTITY_MATRIX[i]);
  if (!identity) parts.push(`matrix(${m.map(fmt).join(', ')})`);
  if (s.bbox && s.rotate) {
    const { cx, cy } = around(s.bbox, s.rotate.pivot);
    parts.push(
      `translate(${px(cx)}, ${px(cy)})`,
      `rotate(${rotation ?? `${fmt(s.rotate.angle)}deg`})`,
      `translate(${px(-cx)}, ${px(-cy)})`,
    );
  }
  if (s.bbox && s.scale) {
    const { cx, cy } = around(s.bbox, s.scale.pivot);
    parts.push(
      `translate(${px(cx)}, ${px(cy)})`,
      `scale(${fmt(s.scale.sx)}, ${fmt(s.scale.sy)})`,
      `translate(${px(-cx)}, ${px(-cy)})`,
    );
  }
  return parts.join(' ');
}
