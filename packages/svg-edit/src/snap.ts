// Bắt dính (contracts/svg-editor.md §5; FR-103): hàm thuần trên hộp bao trong hệ tài liệu. Loại: điểm (đầu cuối của
// line/polyline/path đa giác), cạnh và tâm của phần tử khác (ngưỡng 6 / zoom), lưới (mặc định 10), góc 15° quanh điểm
// neo (Shift). Ưu tiên: điểm > cạnh/tâm > lưới; hòa thì gần hơn, rồi NodeId tăng. Trả cả đường gióng.
import type { Point } from './matrix.ts';
import type { Box, NodeId } from './node.ts';

export interface SnapBox {
  id: NodeId;
  box: Box;
}
export interface SnapPointTarget {
  id: NodeId;
  x: number;
  y: number;
}
export interface SnapConfig {
  zoom: number;
  /** Ngưỡng theo điểm ảnh màn hình (mặc định 6). */
  threshold?: number;
  /** Bước lưới; null hoặc 0: tắt (mặc định 10). */
  grid?: number | null;
  objects?: readonly SnapBox[];
  points?: readonly SnapPointTarget[];
  /** Khóa góc (Shift): hướng từ `anchor` bắt theo bội `step` độ (mặc định 15); khi bật, các loại khác không áp. */
  angle?: { anchor: Point; step?: number } | null;
}

export type SnapKind = 'point' | 'edge' | 'center' | 'grid' | 'angle';

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  kind: Exclude<SnapKind, 'angle'>;
  targetId?: NodeId;
}

export interface SnapResult {
  x: number;
  y: number;
  kindX?: SnapKind;
  kindY?: SnapKind;
  guides: Guide[];
}

export const DEFAULT_GRID = 10;
export const DEFAULT_THRESHOLD_PX = 6;

interface Line {
  pos: number;
  kind: 'edge' | 'center';
  id: NodeId;
}

function lines(objects: readonly SnapBox[] | undefined, axis: 'x' | 'y'): Line[] {
  const out: Line[] = [];
  for (const o of objects ?? []) {
    const a = axis === 'x' ? o.box.x : o.box.y;
    const s = axis === 'x' ? o.box.width : o.box.height;
    out.push(
      { pos: a, kind: 'edge', id: o.id },
      { pos: a + s / 2, kind: 'center', id: o.id },
      { pos: a + s, kind: 'edge', id: o.id },
    );
  }
  return out;
}

/** Ứng viên tốt nhất: khoảng cách nhỏ nhất, hòa thì NodeId nhỏ hơn. */
function better(d: number, id: NodeId, bestD: number, bestId: NodeId): boolean {
  return d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && id < bestId);
}

/** Bắt một trục: các giá trị tham chiếu `refs` của vật đang kéo so với đường của đích. Trả độ dịch tốt nhất. */
function snapAxis(
  refs: readonly number[],
  targets: readonly Line[],
  th: number,
): { delta: number; line: Line } | null {
  let best: { delta: number; line: Line } | null = null;
  let bestD = Infinity;
  let bestId = Infinity;
  for (const r of refs)
    for (const l of targets) {
      const d = Math.abs(l.pos - r);
      if (d > th) continue;
      if (better(d, l.id, bestD, bestId)) {
        best = { delta: l.pos - r, line: l };
        bestD = d;
        bestId = l.id;
      }
    }
  return best;
}

const gridOn = (cfg: SnapConfig): number | null => {
  const g = cfg.grid === undefined ? DEFAULT_GRID : cfg.grid;
  return g && g > 0 ? g : null;
};

export function snapPoint(p: Point, cfg: SnapConfig): SnapResult {
  if (cfg.angle) {
    const step = ((cfg.angle.step ?? 15) * Math.PI) / 180;
    const a = cfg.angle.anchor;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = dx * Math.cos(ang) + dy * Math.sin(ang);
    return {
      x: a.x + len * Math.cos(ang),
      y: a.y + len * Math.sin(ang),
      kindX: 'angle',
      kindY: 'angle',
      guides: [],
    };
  }
  const th = (cfg.threshold ?? DEFAULT_THRESHOLD_PX) / cfg.zoom;
  // 1. điểm
  let bp: SnapPointTarget | null = null;
  let bd = Infinity;
  for (const t of cfg.points ?? []) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= th && better(d, t.id, bd, bp ? bp.id : Infinity)) {
      bp = t;
      bd = d;
    }
  }
  if (bp)
    return {
      x: bp.x,
      y: bp.y,
      kindX: 'point',
      kindY: 'point',
      guides: [
        { axis: 'x', pos: bp.x, kind: 'point', targetId: bp.id },
        { axis: 'y', pos: bp.y, kind: 'point', targetId: bp.id },
      ],
    };
  // 2. cạnh/tâm, 3. lưới (từng trục)
  const res: SnapResult = { x: p.x, y: p.y, guides: [] };
  const g = gridOn(cfg);
  for (const axis of ['x', 'y'] as const) {
    const v = axis === 'x' ? p.x : p.y;
    const s = snapAxis([v], lines(cfg.objects, axis), th);
    let nv = v;
    let kind: SnapKind | undefined;
    if (s) {
      nv = v + s.delta;
      kind = s.line.kind;
      res.guides.push({ axis, pos: s.line.pos, kind: s.line.kind, targetId: s.line.id });
    } else if (g !== null) {
      nv = Math.round(v / g) * g;
      kind = 'grid';
    }
    if (axis === 'x') {
      res.x = nv;
      res.kindX = kind;
    } else {
      res.y = nv;
      res.kindY = kind;
    }
  }
  return res;
}

/** Bắt khi kéo hộp `box` thêm (dx, dy): góc và tâm vào điểm; cạnh/tâm vào cạnh/tâm; cạnh trái/trên vào lưới. */
export function snapMove(
  box: Box,
  dx: number,
  dy: number,
  cfg: SnapConfig,
): { dx: number; dy: number; kindX?: SnapKind; kindY?: SnapKind; guides: Guide[] } {
  const th = (cfg.threshold ?? DEFAULT_THRESHOLD_PX) / cfg.zoom;
  const x0 = box.x + dx;
  const y0 = box.y + dy;
  const xs = [x0, x0 + box.width / 2, x0 + box.width];
  const ys = [y0, y0 + box.height / 2, y0 + box.height];
  // 1. điểm: các góc và tâm của hộp
  let best: { t: SnapPointTarget; ox: number; oy: number } | null = null;
  let bd = Infinity;
  const refs: Point[] = [
    { x: xs[0], y: ys[0] },
    { x: xs[2], y: ys[0] },
    { x: xs[0], y: ys[2] },
    { x: xs[2], y: ys[2] },
    { x: xs[1], y: ys[1] },
  ];
  for (const t of cfg.points ?? [])
    for (const r of refs) {
      const d = Math.hypot(t.x - r.x, t.y - r.y);
      if (d <= th && better(d, t.id, bd, best ? best.t.id : Infinity)) {
        best = { t, ox: t.x - r.x, oy: t.y - r.y };
        bd = d;
      }
    }
  if (best)
    return {
      dx: dx + best.ox,
      dy: dy + best.oy,
      kindX: 'point',
      kindY: 'point',
      guides: [
        { axis: 'x', pos: best.t.x, kind: 'point', targetId: best.t.id },
        { axis: 'y', pos: best.t.y, kind: 'point', targetId: best.t.id },
      ],
    };
  const out: { dx: number; dy: number; kindX?: SnapKind; kindY?: SnapKind; guides: Guide[] } = {
    dx,
    dy,
    guides: [],
  };
  const g = gridOn(cfg);
  for (const axis of ['x', 'y'] as const) {
    const s = snapAxis(axis === 'x' ? xs : ys, lines(cfg.objects, axis), th);
    let delta = 0;
    let kind: SnapKind | undefined;
    if (s) {
      delta = s.delta;
      kind = s.line.kind;
      out.guides.push({ axis, pos: s.line.pos, kind: s.line.kind, targetId: s.line.id });
    } else if (g !== null) {
      const v = axis === 'x' ? xs[0] : ys[0];
      delta = Math.round(v / g) * g - v;
      kind = 'grid';
    }
    if (axis === 'x') {
      out.dx += delta;
      out.kindX = kind;
    } else {
      out.dy += delta;
      out.kindY = kind;
    }
  }
  return out;
}
