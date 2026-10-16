// Mô hình inspector của trình vẽ SVG (feature 011, T163; FR-106; contracts/svg-editor.md §8): đọc giá trị cho các tab Chung,
// Hình học, Hiển thị, Văn bản của vùng chọn và biến một ô nhập thành lô lệnh. Thuộc tính trình bày ghi vào `style` khi phần tử
// đã khai thuộc tính đó trong `style` (style thắng thuộc tính), ngược lại ghi thuộc tính. Tô gradient có sẵn được giữ (chỉ
// đổi được thành màu khác hoặc không tô). Không DOM.
import { parseDeclarations } from '@mat/svg-renderer';
import {
  SAFE_FONTS,
  checkFont,
  decompose,
  editablePoints,
  elementChildren,
  hasSkew,
  inherited,
  isInsideOpaque,
  layerOf,
  opaqueBlockOf,
  presentation,
  rotateM,
  scaleM,
  textOf,
  transformOf,
  translateM,
  type Box,
  type NodeId,
} from '@mat/svg-edit';
import type { ApplyResult } from './session.ts';
import type { SvgEditor } from './editor.ts';

export type PropKey =
  | 'id'
  | 'name'
  | 'layer'
  | 'x'
  | 'y'
  | 'w'
  | 'h'
  | 'angle'
  | 'rx'
  | 'ry'
  | 'r'
  | 'fill'
  | 'stroke'
  | 'stroke-width'
  | 'stroke-dasharray'
  | 'stroke-linecap'
  | 'opacity'
  | 'visibility'
  | 'non-scaling-stroke'
  | 'text'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'font-style'
  | 'text-anchor';

export interface PropsView {
  count: number;
  tag: string | null;
  id: string;
  name: string;
  uid: string;
  layer: string | null;
  box: Box | null;
  angle: number | null;
  /** Ghi độ lớn vào thuộc tính hình học (bake) hay `transform`. */
  writes: 'attrs' | 'transform' | null;
  rx?: string;
  ry?: string;
  r?: string;
  fill: string;
  stroke: string;
  strokeWidth: string;
  dash: string;
  cap: string;
  opacity: string;
  visibility: string;
  nonScaling: boolean;
  text?: {
    content: string;
    family: string;
    size: string;
    bold: boolean;
    italic: boolean;
    anchor: string;
    fontWarning: boolean;
    hasTspan: boolean;
  };
  /** Ghi chú (khối giữ nguyên, khóa sửa nút, gradient). */
  notes: string[];
}

export const DASH_PRESETS: readonly string[] = ['none', '4 2', '2 2', '8 4'];
export { SAFE_FONTS };

const BAKE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const PAINT_TAGS = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'g',
  'use',
]);
const isGradient = (v: string) => /^url\(/.test(v.trim());

/** Thông tin cho inspector; vùng chọn rỗng: `count` 0. */
export function propsOf(ed: SvgEditor): PropsView {
  const doc = ed.doc;
  const sel = ed.selection;
  const one = sel.length === 1 ? sel[0] : null;
  const n = one !== null ? doc.nodes.get(one)! : null;
  const box = ed.selectionBox();
  const view: PropsView = {
    count: sel.length,
    tag: n?.tag ?? null,
    id: n?.attrs.get('id') ?? '',
    name: n?.attrs.get('data-mat-name') ?? '',
    uid: n?.attrs.get('data-mat-uid') ?? '',
    layer: one !== null ? layerOf(doc, one) : sel.length ? layerOf(doc, sel[0]) : ed.currentLayer,
    box,
    angle: null,
    writes: null,
    fill: '',
    stroke: '',
    strokeWidth: '',
    dash: 'none',
    cap: 'butt',
    opacity: '1',
    visibility: 'visible',
    nonScaling: false,
    notes: [],
  };
  if (sel.length === 0) return view;
  const ref = one ?? sel[0];
  const rn = doc.nodes.get(ref)!;
  view.fill = inherited(doc, ref, 'fill') ?? 'black';
  view.stroke = inherited(doc, ref, 'stroke') ?? 'none';
  view.strokeWidth = inherited(doc, ref, 'stroke-width') ?? '1';
  view.dash = inherited(doc, ref, 'stroke-dasharray') ?? 'none';
  view.cap = inherited(doc, ref, 'stroke-linecap') ?? 'butt';
  view.opacity = presentation(rn, 'opacity') ?? '1';
  view.visibility = inherited(doc, ref, 'visibility') ?? 'visible';
  view.nonScaling = presentation(rn, 'vector-effect') === 'non-scaling-stroke';
  if (isGradient(view.fill)) view.notes.push('gradient');
  if (n) {
    const m = transformOf(doc, one!);
    view.angle = hasSkew(m) ? null : Math.round(decompose(m).angle * 1000) / 1000;
    view.writes = BAKE_TAGS.has(n.tag) && !hasSkew(m) ? 'attrs' : 'transform';
    if (n.tag === 'rect') {
      view.rx = n.attrs.get('rx') ?? '0';
      view.ry = n.attrs.get('ry') ?? '';
    }
    if (n.tag === 'circle') view.r = n.attrs.get('r') ?? '0';
    if (n.tag === 'ellipse') {
      view.rx = n.attrs.get('rx') ?? '0';
      view.ry = n.attrs.get('ry') ?? '0';
    }
    if (n.tag === 'text' || n.tag === 'tspan') {
      const fam = inherited(doc, one!, 'font-family') ?? 'sans-serif';
      const hasTspan = n.children.some((c) => doc.nodes.get(c)?.tag === 'tspan');
      view.text = {
        content: hasTspan
          ? elementChildren(doc, one!)
              .map((c) => textOf(doc, c))
              .join(' ')
          : textOf(doc, one!),
        family: fam,
        size: inherited(doc, one!, 'font-size') ?? '16',
        bold: /^(bold|bolder|[6-9]00)$/.test(inherited(doc, one!, 'font-weight') ?? ''),
        italic: (inherited(doc, one!, 'font-style') ?? '') === 'italic',
        anchor: inherited(doc, one!, 'text-anchor') ?? 'start',
        fontWarning: checkFont(fam) !== null,
        hasTspan,
      };
    }
    if (opaqueBlockOf(doc, one!) === one) view.notes.push('opaque');
    if (n.tag === 'path') {
      const pts = editablePoints(doc, one!);
      if (!pts.ok) view.notes.push('curves');
    }
  }
  return view;
}

/** Đặt thuộc tính trình bày (`style` thắng thuộc tính): trả [nút, tên, giá trị]. */
export function presentationChange(
  ed: SvgEditor,
  id: NodeId,
  prop: string,
  value: string | null,
): Array<[NodeId, string, string | null]> {
  const n = ed.doc.nodes.get(id)!;
  const st = n.attrs.get('style');
  if (st !== undefined) {
    const decls = parseDeclarations(st);
    if (decls.some((d) => d.prop === prop)) {
      const next = decls
        .filter((d) => value !== null || d.prop !== prop)
        .map((d) => `${d.prop}:${d.prop === prop ? value : d.value}`)
        .join(';');
      return [[id, 'style', next === '' ? null : next]];
    }
  }
  return [[id, prop, value]];
}

const number = (v: string): number | null => {
  const t = v.trim().replace(',', '.');
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Kiểm giá trị ô nhập trước khi áp: trả lý do sai (tiếng Việt) hoặc null. */
export function checkProp(key: PropKey, value: string): string | null {
  switch (key) {
    case 'x':
    case 'y':
    case 'angle':
      return number(value) === null ? 'Cần một số' : null;
    case 'w':
    case 'h':
    case 'stroke-width':
    case 'font-size': {
      const v = number(value);
      return v === null || v <= 0 ? 'Cần một số lớn hơn 0' : null;
    }
    case 'rx':
    case 'ry':
    case 'r': {
      const v = number(value);
      return v === null || v < 0 ? 'Cần một số không âm' : null;
    }
    case 'opacity': {
      const v = number(value);
      return v === null || v < 0 || v > 1 ? 'Độ mờ từ 0 đến 1' : null;
    }
    case 'id':
      return value === '' || /^[A-Za-z_][\w.-]*$/.test(value)
        ? null
        : 'id bắt đầu bằng chữ cái hoặc _, chỉ gồm chữ, số, _ . -';
    default:
      return null;
  }
}

/**
 * Áp một ô của inspector cho vùng chọn (một lô, một bước hoàn tác). `lockRatio`: Rộng/Cao giữ tỉ lệ. Màu kéo liên tục dùng
 * `mergeKey` để gộp thành một bước tới khi `endGesture`.
 */
export function setProp(
  ed: SvgEditor,
  key: PropKey,
  value: string,
  opts: { lockRatio?: boolean; mergeKey?: string } = {},
): ApplyResult | { ok: false; targets: []; reason: string } {
  const bad = checkProp(key, value);
  if (bad) return { ok: false, targets: [], reason: bad };
  const sel = ed.selection;
  const fail = (reason: string) => ({ ok: false as const, targets: [] as [], reason });
  if (!sel.length) return fail('Chưa chọn phần tử');
  const doc = ed.doc;
  const box = ed.selectionBox();
  const v = number(value);
  for (const id of sel)
    if (isInsideOpaque(doc, id)) return fail('Phần tử nằm trong khối giữ nguyên: không sửa được');
  switch (key) {
    case 'x':
    case 'y': {
      if (!box || v === null) return fail('Không có hộp bao');
      const dx = key === 'x' ? v - box.x : 0;
      const dy = key === 'y' ? v - box.y : 0;
      if (dx === 0 && dy === 0) return { ok: true, targets: [] };
      return ed.transformSelection(translateM(dx, dy), 'Di chuyển') ?? fail('');
    }
    case 'w':
    case 'h': {
      if (!box || v === null || box.width === 0 || box.height === 0)
        return fail('Phần tử không có kích thước để co');
      let sx = key === 'w' ? v / box.width : 1;
      let sy = key === 'h' ? v / box.height : 1;
      if (opts.lockRatio) {
        if (key === 'w') sy = sx;
        else sx = sy;
      }
      if (sx === 1 && sy === 1) return { ok: true, targets: [] };
      return ed.transformSelection(scaleM(sx, sy, box.x, box.y), 'Đổi cỡ') ?? fail('');
    }
    case 'angle': {
      if (!box || v === null) return fail('Không có hộp bao');
      const cur = sel.length === 1 ? (propsOf(ed).angle ?? 0) : 0;
      const d = v - cur;
      if (d === 0) return { ok: true, targets: [] };
      return (
        ed.transformSelection(rotateM(d, box.x + box.width / 2, box.y + box.height / 2), 'Xoay') ??
        fail('')
      );
    }
    case 'rx':
    case 'ry':
    case 'r': {
      const changes = sel
        .filter((id) => {
          const tag = doc.nodes.get(id)!.tag;
          return key === 'r' ? tag === 'circle' : tag === 'rect' || tag === 'ellipse';
        })
        .map(
          (id) =>
            [id, key, value.trim() === '' ? null : String(v)] as [NodeId, string, string | null],
        );
      return ed.setAttrs(changes, key === 'r' ? 'Bán kính' : 'Bo góc');
    }
    case 'id':
      return ed.setAttrs([[sel[0], 'id', value === '' ? null : value]], 'Đổi id');
    case 'name':
      return ed.rename(sel[0], value);
    case 'layer':
      return ed.moveSelectionToLayer(value === '' ? null : value) ?? fail('');
    case 'fill':
    case 'stroke':
    case 'stroke-width':
    case 'stroke-dasharray':
    case 'stroke-linecap':
    case 'opacity':
    case 'visibility': {
      const val =
        value.trim() === ''
          ? null
          : key === 'stroke-dasharray' && value === 'none'
            ? null
            : value.trim();
      const changes = sel
        .filter((id) => PAINT_TAGS.has(doc.nodes.get(id)!.tag))
        .flatMap((id) => presentationChange(ed, id, key, val));
      return ed.setAttrs(
        changes,
        key === 'fill' || key === 'stroke' ? 'Đổi màu' : 'Hiển thị',
        opts.mergeKey,
      );
    }
    case 'non-scaling-stroke': {
      const on = value === 'true';
      const changes = sel.flatMap((id) =>
        presentationChange(ed, id, 'vector-effect', on ? 'non-scaling-stroke' : null),
      );
      return ed.setAttrs(changes, 'Co cả nét');
    }
    case 'font-family':
    case 'font-size':
    case 'font-weight':
    case 'font-style':
    case 'text-anchor': {
      const changes = sel
        .filter((id) => {
          const tag = doc.nodes.get(id)!.tag;
          return tag === 'text' || tag === 'tspan';
        })
        .flatMap((id) =>
          presentationChange(ed, id, key, value.trim() === '' ? null : value.trim()),
        );
      if (!changes.length) return fail('Chọn phần tử chữ');
      return ed.setAttrs(changes, 'Văn bản');
    }
    case 'text': {
      if (sel.length !== 1) return fail('Chọn một phần tử chữ');
      ed.beginTextEdit(sel[0]);
      return ed.commitText(value) ?? { ok: true, targets: [] };
    }
  }
}
