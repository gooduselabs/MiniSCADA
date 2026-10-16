// Đường gióng của trình vẽ SVG (feature 011, T162; FR-103; mockup studio-svg-draw cảnh 1): đường gióng tạm khi bắt dính (cạnh,
// tâm, điểm, lưới; màu --guide, nhãn loại) và đường gióng cố định kéo từ thước (lưu ở .mat-editor/svg-state.json, là đích
// bắt dính). Vẽ trên lớp phủ của canvas, theo điểm ảnh màn hình.
import type { Guide } from '@mat/svg-edit';
import { t as tr, type MessageKey } from '../../i18n/index.ts';
import type { GuideLine } from '../../model/svg-state.ts';
import type { ViewMap } from './handles.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Đường dài đủ phủ khung nhìn (điểm ảnh). */
const FAR = 100_000;

const KIND_LABEL: Record<Guide['kind'], MessageKey> = {
  edge: 'svgd.guide.edge',
  center: 'svgd.guide.center',
  point: 'svgd.guide.point',
  grid: 'svgd.guide.grid',
};

function line(ov: SVGSVGElement, axis: 'x' | 'y', at: number, attrs: Record<string, string>): void {
  const l = document.createElementNS(SVG_NS, 'line');
  if (axis === 'x') {
    l.setAttribute('x1', String(at));
    l.setAttribute('x2', String(at));
    l.setAttribute('y1', String(-FAR));
    l.setAttribute('y2', String(FAR));
  } else {
    l.setAttribute('y1', String(at));
    l.setAttribute('y2', String(at));
    l.setAttribute('x1', String(-FAR));
    l.setAttribute('x2', String(FAR));
  }
  for (const [k, v] of Object.entries(attrs)) l.setAttribute(k, v);
  ov.append(l);
}

export function drawGuides(
  ov: SVGSVGElement,
  map: ViewMap,
  fixed: readonly GuideLine[],
  snap: readonly Guide[],
): void {
  for (const g of fixed)
    line(ov, g.axis, g.axis === 'x' ? map.x(g.pos) : map.y(g.pos), {
      stroke: 'var(--info, #0b5cad)',
      'stroke-width': '1',
      'stroke-dasharray': '6 4',
      'data-guide': 'fixed',
    });
  const seen = new Set<string>();
  for (const g of snap) {
    const key = `${g.axis}:${g.pos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = g.axis === 'x' ? map.x(g.pos) : map.y(g.pos);
    line(ov, g.axis, at, {
      stroke: 'var(--guide, #c2255c)',
      'stroke-width': '1',
      'data-guide': g.kind,
    });
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(g.axis === 'x' ? at + 4 : 6));
    t.setAttribute('y', String(g.axis === 'x' ? 14 : at - 4));
    t.setAttribute('fill', 'var(--guide, #c2255c)');
    t.setAttribute('font-size', '11');
    t.textContent = tr(KIND_LABEL[g.kind]);
    ov.append(t);
  }
}
