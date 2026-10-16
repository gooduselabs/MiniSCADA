// Điểm gắn: dính khi kéo (contract symbol-library §6). Hàm thuần, không ghi gì vào project.
import type { PortDir } from './manifest.ts';

export interface PortRef {
  itemId: string;
  portId: string;
  /** Tọa độ trong đơn vị thiết kế (đã đổi từ tương đối theo vị trí và cỡ item). */
  x: number;
  y: number;
  dir: PortDir;
  kind: string;
}

export interface PortSnapOptions {
  /** Ngưỡng tính bằng điểm ảnh màn hình; mặc định 10. */
  thresholdPx?: number;
  /** Alt đang giữ: tắt dính (FR-057). */
  disabled?: boolean;
}

export interface PortSnapResult {
  dx: number;
  dy: number;
  pair: [PortRef, PortRef];
}

const OPPOSITE: Record<PortDir, PortDir> = { n: 's', s: 'n', e: 'w', w: 'e' };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Tìm cặp điểm gắn tương thích (cùng `kind`, hướng đối nhau) gần nhất giữa `moving` và `fixed`,
 * khoảng cách (đơn vị thiết kế × zoom) ≤ ngưỡng. Hòa: cặp đầu theo thứ tự id.
 * Trả độ dời (đơn vị thiết kế) để hai điểm trùng, hoặc null.
 */
export function portSnap(
  moving: readonly PortRef[],
  fixed: readonly PortRef[],
  zoom: number,
  opt: PortSnapOptions = {},
): PortSnapResult | null {
  if (opt.disabled === true) return null;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const threshold = opt.thresholdPx ?? 10;
  let best: { m: PortRef; f: PortRef; d: number } | null = null;
  for (const m of moving) {
    for (const f of fixed) {
      if (m.kind !== f.kind || OPPOSITE[m.dir] !== f.dir) continue;
      const d = Math.hypot(f.x - m.x, f.y - m.y) * zoom;
      if (d > threshold + 1e-9) continue;
      if (
        best === null ||
        d < best.d - 1e-9 ||
        (Math.abs(d - best.d) <= 1e-9 && before(m, f, best))
      )
        best = { m, f, d };
    }
  }
  if (best === null) return null;
  return { dx: best.f.x - best.m.x, dy: best.f.y - best.m.y, pair: [best.m, best.f] };
}

/** Thứ tự id của cặp (m, f) so với cặp tốt nhất hiện có, dùng khi hòa khoảng cách. */
function before(m: PortRef, f: PortRef, best: { m: PortRef; f: PortRef }): boolean {
  const c =
    cmp(m.itemId, best.m.itemId) ||
    cmp(m.portId, best.m.portId) ||
    cmp(f.itemId, best.f.itemId) ||
    cmp(f.portId, best.f.portId);
  return c < 0;
}
