// Lớp phủ của canvas trình vẽ SVG (feature 011, T162; FR-101, FR-107; mockup studio-svg-draw cảnh 1): khung từng phần tử chọn,
// hộp bao chung với 8 tay nắm đổi cỡ và tay nắm xoay, khung chọn, hình đang vẽ, đường đa tuyến đang vẽ, các nút của công cụ
// Sửa nút, bản xem nhanh (hộp bao biến đổi) khi kéo ≥ 200 nút. Vẽ theo điểm ảnh màn hình (không co theo zoom). Chỉ là lớp
// phủ (aria-hidden): trạng thái đọc được ở thanh trạng thái và inspector; mọi thao tác có phím tương đương.
import { applyPoint, type Box, type NodeId, type Point } from '@mat/svg-edit';
import { HANDLES, type SvgEditor } from '../../model/svg/editor.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HANDLE_PX = 8;
/** Khoảng từ cạnh trên hộp bao tới tay nắm xoay (điểm ảnh). */
export const ROT_PX = 22;

export interface ViewMap {
  zoom: number;
  x(v: number): number;
  y(v: number): number;
}

const el = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const ACCENT = 'var(--accent, #0b7285)';
const GUIDE = 'var(--guide, #c2255c)';
const PANEL = 'var(--panel, #fff)';

/** Hộp màn hình của hộp tài liệu. */
function screenBox(map: ViewMap, b: Box): Box {
  const x0 = map.x(b.x);
  const y0 = map.y(b.y);
  return { x: x0, y: y0, width: b.width * map.zoom, height: b.height * map.zoom };
}

/** Vị trí tay nắm (điểm ảnh màn hình) của hộp màn hình. */
export function handlePoints(b: Box): Record<string, Point> {
  const x0 = b.x;
  const y0 = b.y;
  const x1 = b.x + b.width;
  const y1 = b.y + b.height;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    nw: { x: x0, y: y0 },
    n: { x: cx, y: y0 },
    ne: { x: x1, y: y0 },
    e: { x: x1, y: cy },
    se: { x: x1, y: y1 },
    s: { x: cx, y: y1 },
    sw: { x: x0, y: y1 },
    w: { x: x0, y: cy },
    rot: { x: cx, y: y0 - ROT_PX },
  };
}

const CURSOR: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  rot: 'grab',
};

export function drawOverlay(
  ov: SVGSVGElement,
  map: ViewMap,
  ed: SvgEditor,
  boxOf: (id: NodeId) => Box | null,
): void {
  const p = ed.preview;
  // khung từng phần tử chọn
  for (const id of ed.selection.slice(0, 500)) {
    const b = boxOf(id);
    if (!b) continue;
    const s = screenBox(map, b);
    ov.append(
      el('rect', {
        x: s.x,
        y: s.y,
        width: Math.max(s.width, 1),
        height: Math.max(s.height, 1),
        fill: 'none',
        stroke: ACCENT,
        'stroke-width': 1,
        'stroke-dasharray': ed.selection.length > 1 ? '3 2' : 'none',
      }),
    );
  }
  const sel = ed.selectionBox();
  if (sel && p?.kind === 'transform') {
    // bản xem (hộp bao biến đổi): đa giác bốn góc
    const corners = [
      { x: sel.x, y: sel.y },
      { x: sel.x + sel.width, y: sel.y },
      { x: sel.x + sel.width, y: sel.y + sel.height },
      { x: sel.x, y: sel.y + sel.height },
    ].map((c) => applyPoint(p.matrix, c));
    ov.append(
      el('polygon', {
        points: corners.map((c) => `${map.x(c.x)},${map.y(c.y)}`).join(' '),
        fill: p.quick ? 'rgba(11,114,133,.08)' : 'none',
        stroke: ACCENT,
        'stroke-width': 1.5,
        'stroke-dasharray': '4 3',
        'data-preview': p.quick ? 'quick' : 'dom',
      }),
    );
  } else if (sel && ed.tool === 'select' && !ed.textTarget) {
    const s = screenBox(map, sel);
    const hp = handlePoints(s);
    ov.append(
      el('line', {
        x1: hp.n.x,
        y1: hp.n.y,
        x2: hp.rot.x,
        y2: hp.rot.y,
        stroke: ACCENT,
        'stroke-width': 1,
      }),
    );
    for (const h of [...HANDLES, 'rot'] as const) {
      const q = hp[h];
      const r = HANDLE_PX / 2;
      const shape =
        h === 'rot'
          ? el('circle', { cx: q.x, cy: q.y, r: r + 1 })
          : el('rect', { x: q.x - r, y: q.y - r, width: HANDLE_PX, height: HANDLE_PX });
      shape.setAttribute('fill', PANEL);
      shape.setAttribute('stroke', ACCENT);
      shape.setAttribute('stroke-width', '1.5');
      shape.setAttribute('class', 'hit');
      shape.setAttribute('data-h', h);
      shape.setAttribute('style', `cursor:${CURSOR[h]}`);
      ov.append(shape);
    }
  }
  // nút của công cụ Sửa nút
  if (ed.tool === 'node') {
    const pts = ed.points();
    pts?.forEach((q, i) => {
      const x = map.x(q.x);
      const y = map.y(q.y);
      ov.append(
        el('rect', {
          x: x - 4,
          y: y - 4,
          width: 8,
          height: 8,
          fill: ed.activePoint === i ? ACCENT : PANEL,
          stroke: ACCENT,
          'stroke-width': 1.5,
          class: 'hit',
          'data-h': `pt:${i}`,
          style: 'cursor:move',
        }),
      );
    });
  }
  if (!p) return;
  if (p.kind === 'marquee') {
    const s = screenBox(map, p.box);
    ov.append(
      el('rect', {
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        fill: 'rgba(11,114,133,.08)',
        stroke: ACCENT,
        'stroke-dasharray': '4 3',
        'data-preview': 'marquee',
      }),
    );
  } else if (p.kind === 'shape') {
    const sh = p.shape;
    const common = {
      fill: 'none',
      stroke: ACCENT,
      'stroke-width': 1.5,
      'stroke-dasharray': '5 3',
      'data-preview': 'shape',
    };
    if (sh.kind === 'rect')
      ov.append(
        el('rect', {
          x: map.x(sh.x),
          y: map.y(sh.y),
          width: sh.width * map.zoom,
          height: sh.height * map.zoom,
          ...common,
        }),
      );
    else if (sh.kind === 'ellipse')
      ov.append(
        el('ellipse', {
          cx: map.x(sh.cx),
          cy: map.y(sh.cy),
          rx: sh.rx * map.zoom,
          ry: sh.ry * map.zoom,
          ...common,
        }),
      );
    else if (sh.kind === 'circle')
      ov.append(
        el('circle', { cx: map.x(sh.cx), cy: map.y(sh.cy), r: sh.r * map.zoom, ...common }),
      );
    else if (sh.kind === 'line')
      ov.append(
        el('line', {
          x1: map.x(sh.x1),
          y1: map.y(sh.y1),
          x2: map.x(sh.x2),
          y2: map.y(sh.y2),
          ...common,
        }),
      );
  } else if (p.kind === 'poly') {
    const pts = [...p.points, ...(p.cursor ? [p.cursor] : [])];
    ov.append(
      el('polyline', {
        points: pts.map((q) => `${map.x(q.x)},${map.y(q.y)}`).join(' '),
        fill: 'none',
        stroke: ACCENT,
        'stroke-width': 1.5,
        'stroke-dasharray': '5 3',
        'data-preview': 'poly',
      }),
    );
    for (const q of p.points)
      ov.append(el('circle', { cx: map.x(q.x), cy: map.y(q.y), r: 3, fill: PANEL, stroke: GUIDE }));
  }
}
