// Bắt dính lưới và đường gióng (feature 007, T098; R20). Hàm thuần, đơn vị thiết kế.
// Ngưỡng gióng = 6 điểm ảnh màn hình = `6 / zoom` đơn vị thiết kế.
import type { Rect } from '@mat/project-schema';
import { portSnap, type PortRef, type PortSnapResult } from '@mat/symbols';
import { boundsOf } from './align.ts';
import { handleEdges, type Handle } from './resize.ts';

export const SNAP_PX = 6;

export interface SnapOptions {
  /** Bước lưới (đơn vị thiết kế); 0 = không có lưới. */
  grid: number;
  zoom: number;
  /** Bật bắt dính (lưới và đường gióng). */
  snap: boolean;
  /** Alt: tắt bắt dính tạm thời. */
  alt: boolean;
  /** Item không nằm trong vùng đang kéo (bên gọi đã loại item bị ẩn nếu muốn). */
  others: readonly Rect[];
  screen: { width: number; height: number };
}

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  source: 'item' | 'screen';
}
export type SnapKind = 'item' | 'grid' | 'none';

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
  snapX: SnapKind;
  snapY: SnapKind;
}

interface Target {
  pos: number;
  source: 'item' | 'screen';
}

const EPS = 1e-9;
const active = (o: SnapOptions): boolean => o.snap && !o.alt;

function targetsOf(o: SnapOptions, axis: 'x' | 'y'): Target[] {
  const out: Target[] = [];
  const push = (start: number, len: number, source: Target['source']) =>
    out.push(
      { pos: start, source },
      { pos: start + len / 2, source },
      { pos: start + len, source },
    );
  for (const r of o.others) {
    if (axis === 'x') push(r.x, r.width, 'item');
    else push(r.y, r.height, 'item');
  }
  if (axis === 'x') push(0, o.screen.width, 'screen');
  else push(0, o.screen.height, 'screen');
  return out;
}

interface AxisResult {
  value: number;
  kind: SnapKind;
  guides: Guide[];
}

/**
 * Một trục: `offsets` là vị trí các cạnh cần dính so với `origin` (ví dụ `[0, len/2, len]`). Chọn ứng
 * viên gần nhất trong ngưỡng; không có thì dính lưới (nếu có), ngược lại làm tròn.
 */
function snapAxis(
  axis: 'x' | 'y',
  origin: number,
  offsets: readonly number[],
  o: SnapOptions,
): AxisResult {
  if (!active(o)) return { value: Math.round(origin), kind: 'none', guides: [] };
  const targets = targetsOf(o, axis);
  const thr = SNAP_PX / o.zoom + EPS;
  let best: number | null = null;
  for (const off of offsets)
    for (const t of targets) {
      const d = t.pos - (origin + off);
      if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  let value: number;
  let kind: SnapKind;
  if (best !== null) {
    value = Math.round(origin + best);
    kind = 'item';
  } else if (o.grid > 0) {
    value = Math.round(origin / o.grid) * o.grid;
    kind = 'grid';
  } else {
    value = Math.round(origin);
    kind = 'none';
  }
  const guides: Guide[] = [];
  for (const off of offsets)
    for (const t of targets)
      if (
        Math.abs(t.pos - (value + off)) < EPS &&
        !guides.some((g) => g.pos === t.pos && g.source === t.source)
      )
        guides.push({ axis, pos: t.pos, source: t.source });
  return { value, kind, guides };
}

/** Bắt dính hộp (x, y) với cạnh trái/giữa/phải và trên/giữa/dưới; lưới áp cho cạnh trái và trên. */
export function snapBox(box: Rect, o: SnapOptions): SnapResult {
  const sx = snapAxis('x', box.x, [0, box.width / 2, box.width], o);
  const sy = snapAxis('y', box.y, [0, box.height / 2, box.height], o);
  return {
    x: sx.value,
    y: sy.value,
    guides: [...sx.guides, ...sy.guides],
    snapX: sx.kind,
    snapY: sy.kind,
  };
}

/** Điểm gắn đang di chuyển (tọa độ so với góc trên trái của hộp) và điểm gắn cố định (tuyệt đối), đơn vị thiết kế. */
export interface PortSnapInput {
  moving: readonly PortRef[];
  fixed: readonly PortRef[];
}

export interface PortBoxResult extends Omit<SnapResult, 'snapX' | 'snapY'> {
  snapX: SnapKind | 'port';
  snapY: SnapKind | 'port';
  /** Cặp điểm gắn đã dính (có thì đã thắng dính lưới và đường gióng). */
  port?: PortSnapResult;
}

/**
 * Như `snapBox` nhưng thêm dính điểm gắn (feature 008, T090; contract symbol-library §6): tính trên vị trí thô; có cặp
 * tương thích trong ngưỡng thì cặp đó thắng lưới và đường gióng (kết quả làm tròn). Alt hoặc tắt bắt dính thì không dính.
 */
export function snapBoxWithPorts(box: Rect, o: SnapOptions, ports: PortSnapInput): PortBoxResult {
  const base = snapBox(box, o);
  if (!active(o) || ports.moving.length === 0 || ports.fixed.length === 0) return base;
  const abs = ports.moving.map((p) => ({ ...p, x: box.x + p.x, y: box.y + p.y }));
  const hit = portSnap(abs, ports.fixed, o.zoom);
  if (hit === null) return base;
  return {
    x: Math.round(box.x + hit.dx),
    y: Math.round(box.y + hit.dy),
    guides: [],
    snapX: 'port',
    snapY: 'port',
    port: hit,
  };
}

/** Kéo nhiều item: bắt dính theo hộp bao; trả chênh lệch đã chỉnh (nguyên) và đường gióng. */
export function snapDrag(
  rects: readonly Rect[],
  dx: number,
  dy: number,
  o: SnapOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const b = boundsOf(rects);
  const s = snapBox({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }, o);
  return { dx: s.x - b.x, dy: s.y - b.y, guides: s.guides };
}

/** Đổi cỡ: chỉ cạnh đang kéo dính; trục không liên quan giữ nguyên chênh lệch đầu vào. */
export function snapResizeDelta(
  box: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  o: SnapOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const e = handleEdges(handle);
  const guides: Guide[] = [];
  let ndx = dx;
  let ndy = dy;
  if (e.e || e.w) {
    const base = e.e ? box.x + box.width : box.x;
    const s = snapAxis('x', base + dx, [0], o);
    ndx = s.value - base;
    guides.push(...s.guides);
  }
  if (e.s || e.n) {
    const base = e.s ? box.y + box.height : box.y;
    const s = snapAxis('y', base + dy, [0], o);
    ndy = s.value - base;
    guides.push(...s.guides);
  }
  return { dx: ndx, dy: ndy, guides };
}
