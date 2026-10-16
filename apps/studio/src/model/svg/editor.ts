// Bộ điều khiển của trình vẽ SVG (feature 011, T162, T163; FR-099, FR-101, FR-103, FR-104, FR-107; contracts/svg-editor.md §5,
// §8, §9): công cụ, vùng chọn, chọn sâu vào nhóm, khung chọn, tay nắm đổi cỡ 8 hướng và xoay, kéo có bắt dính và đường gióng,
// vẽ hình mới, sửa nút, dịch bằng phím, xếp lớp, căn chỉnh, nhóm, lớp. Không DOM: giao diện đổi sự kiện chuột thành tọa độ
// tài liệu và mã nút bị nhấp (`hit`), rồi vẽ `preview` (biến đổi xem trước) và `guides`. Mỗi thao tác là MỘT lô lệnh của
// @mat/svg-edit, qua `SvgSession.apply` (một bước hoàn tác). Kéo không đổi tài liệu cho tới khi thả (xem trước bằng ma trận),
// nên kéo một phần tử trong tài liệu 2.000 phần tử không tính lại gì của tài liệu.
import {
  Batch,
  CommandError,
  SetAttr,
  SetText,
  alignNodes,
  applyPoint,
  bringForward,
  bringToFront,
  copyNodes,
  createLayer,
  createShape,
  ctm,
  deleteLayer,
  deleteNodes,
  deletePoint,
  distributeNodes,
  duplicateNodes,
  editablePoints,
  elementChildren,
  fmt,
  groupNodes,
  insertPoint,
  isAncestorOrSelf,
  isDrawable,
  isElement,
  isInDefinitions,
  isLayer,
  layerOf,
  listLayers,
  moveNodes,
  moveToLayer,
  nearestSegment,
  opaqueBlockOf,
  pasteClip,
  pasteSvgText,
  renameLayer,
  reorderLayer,
  rotateM,
  rotateNodes,
  sameSizeNodes,
  scaleM,
  sendBackward,
  sendToBack,
  setClosed,
  setPoint,
  snapMove,
  snapPoint,
  textOf,
  topLevel,
  transformNodes,
  translateM,
  ungroupNode,
  type AlignMode,
  type Box,
  type ClipData,
  type Command,
  type DrawDoc,
  type Guide,
  type Matrix,
  type NodeId,
  type PasteTextResult,
  type Point,
  type ShapeInput,
  type SnapBox,
  type SnapConfig,
  type SnapPointTarget,
} from '@mat/svg-edit';
import type { GuideLine, LayerState } from '../svg-state.ts';
import { boxOf, contains } from './boxes.ts';
import type { ApplyResult, SvgSession } from './session.ts';

export type ToolId = 'select' | 'node' | 'rect' | 'ellipse' | 'line' | 'poly' | 'text' | 'hand';
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';
export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface Mods {
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export interface SnapSettings {
  grid: boolean;
  gridSize: number;
  objects: boolean;
  points: boolean;
  angle: boolean;
}

export const DEFAULT_SNAP: SnapSettings = {
  grid: true,
  gridSize: 10,
  objects: true,
  points: true,
  angle: true,
};

/** Trạng thái lớp (ẩn, khóa) do svg-state.json giữ; `null`: Lớp mặc định. */
export interface EditorEnv {
  layer(name: string | null): LayerState;
  guides?(): readonly GuideLine[];
}

export type Preview =
  /** Biến đổi xem trước (hệ tài liệu) cho các nút; `quick`: ≥ 200 nút, chỉ vẽ hộp bao. */
  | { kind: 'transform'; ids: readonly NodeId[]; matrix: Matrix; quick: boolean }
  | { kind: 'shape'; shape: ShapeInput }
  | { kind: 'marquee'; box: Box }
  | { kind: 'poly'; points: readonly Point[]; cursor: Point | null };

/** Từ số nút này trở lên, kéo chỉ vẽ hộp bao (bản xem nhanh, contracts/svg-editor.md §11). */
export const QUICK_PREVIEW_NODES = 200;
/** Kéo dưới ngưỡng này (điểm ảnh màn hình) là nhấp. */
const DRAG_PX = 3;
/** Tối thiểu của hình mới (đơn vị tài liệu): nhỏ hơn là nhấp, không vẽ. */
const MIN_SHAPE = 1;
/** Ngưỡng bắt điểm đầu để đóng đa giác, thêm nút trên cạnh (điểm ảnh màn hình). */
const CLOSE_PX = 8;
/** Số phần tử khác tối đa làm đích bắt dính (tài liệu rất lớn: các phần tử đầu theo thứ tự tài liệu). */
const MAX_SNAP_OBJECTS = 4000;

/** Thẻ vẽ được (chọn được trên canvas). */
const SHAPE_TAGS: ReadonlySet<string> = new Set([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'use',
  'image',
  'svg',
  'a',
  'switch',
]);

type Gesture =
  /** `toggleOff`: Shift+nhấp phần tử đã chọn: bỏ khỏi vùng chọn khi thả mà không kéo. */
  | { kind: 'press'; start: Point; hit: NodeId | null; mods: Mods; toggleOff: NodeId | null }
  | { kind: 'move'; start: Point; ids: NodeId[]; box: Box; dx: number; dy: number }
  | {
      kind: 'resize';
      handle: HandleId;
      start: Point;
      ids: NodeId[];
      box: Box;
      matrix: Matrix;
    }
  | { kind: 'rotate'; start: Point; ids: NodeId[]; center: Point; deg: number }
  | { kind: 'marquee'; start: Point; additive: boolean; box: Box }
  | { kind: 'create'; tool: 'rect' | 'ellipse' | 'line'; start: Point; shape: ShapeInput | null }
  | { kind: 'point'; id: NodeId; index: number; moved: boolean }
  | { kind: 'pan' };

export interface TextTarget {
  mode: 'new' | 'edit';
  /** Điểm neo (hệ tài liệu) của hộp nhập. */
  x: number;
  y: number;
  /** Nút `text`/`tspan` đang sửa (chế độ `edit`). */
  id?: NodeId;
  text: string;
  fontSize: number;
}

export interface LayerRow {
  /** `null`: Lớp mặc định (phần tử là con trực tiếp của gốc). */
  name: string | null;
  id: NodeId | null;
  state: LayerState;
  children: NodeId[];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export class SvgEditor {
  tool: ToolId = 'select';
  selection: NodeId[] = [];
  /** Nhóm đang "vào" (chọn sâu); null: cấp trên cùng (con của gốc và của các lớp). */
  scope: NodeId | null = null;
  /** Lớp nhận phần tử mới (null: Lớp mặc định). */
  currentLayer: string | null = null;
  zoom = 1;
  snap: SnapSettings = { ...DEFAULT_SNAP };
  /** Đường gióng khi đang bắt dính (hệ tài liệu). */
  guides: Guide[] = [];
  preview: Preview | null = null;
  /** Lời nhắn gần nhất (lý do từ chối, cảnh báo) cho thanh trạng thái. */
  message: string | null = null;
  /** Điểm của công cụ Đa tuyến/Đa giác đang vẽ. */
  polyPoints: Point[] = [];
  /** Điểm đang chọn của công cụ Sửa nút. */
  activePoint: number | null = null;
  /** Hộp nhập chữ đang mở. */
  textTarget: TextTarget | null = null;
  private gesture: Gesture | null = null;

  readonly session: SvgSession;
  private readonly env: EditorEnv;

  constructor(session: SvgSession, env: EditorEnv) {
    this.session = session;
    this.env = env;
  }

  get doc(): DrawDoc {
    return this.session.doc;
  }

  // ---------- lớp, khả năng chọn ----------

  layerRows(): LayerRow[] {
    const doc = this.doc;
    const rows: LayerRow[] = [];
    const loose: NodeId[] = [];
    for (const c of elementChildren(doc, doc.root)) {
      if (isLayer(doc, c)) continue;
      if (isDrawable(doc, c) && SHAPE_TAGS.has(doc.nodes.get(c)!.tag)) loose.push(c);
    }
    // trên cùng trước (như danh sách lớp của các công cụ vẽ)
    for (const l of [...listLayers(doc)].reverse())
      rows.push({
        name: l.name,
        id: l.id,
        state: this.env.layer(l.name),
        children: elementChildren(doc, l.id)
          .filter((c) => SHAPE_TAGS.has(doc.nodes.get(c)!.tag) && !isInDefinitions(doc, c))
          .reverse(),
      });
    if (loose.length || rows.length === 0)
      rows.push({ name: null, id: null, state: this.env.layer(null), children: loose.reverse() });
    return rows;
  }

  private layerStateOf(id: NodeId): LayerState {
    return this.env.layer(layerOf(this.doc, id));
  }

  /** Phần tử chọn được trên canvas: vẽ được, không ở lớp ẩn hay khóa. */
  canvasSelectable(id: NodeId): boolean {
    const n = this.doc.nodes.get(id);
    if (!n || !isElement(n) || !SHAPE_TAGS.has(n.tag)) return false;
    if (!isDrawable(this.doc, id) && opaqueBlockOf(this.doc, id) !== id) return false;
    const st = this.layerStateOf(id);
    return !st.hidden && !st.locked;
  }

  /** Cha của các phần tử chọn được ở cấp hiện tại cho nút `id`. */
  private containerFor(id: NodeId): NodeId {
    const doc = this.doc;
    if (this.scope !== null && isAncestorOrSelf(doc, this.scope, id) && id !== this.scope)
      return this.scope;
    const layer = layerOf(doc, id);
    if (layer !== null) {
      let cur: NodeId = id;
      while (doc.nodes.get(cur)!.parent !== doc.root) cur = doc.nodes.get(cur)!.parent!;
      return cur;
    }
    return doc.root;
  }

  /** Nút bị nhấp (phần tử dưới con trỏ) → phần tử được chọn: con của nhóm đang vào, hoặc (Ctrl) chính phần tử. */
  resolveHit(hit: NodeId | null, mods: Mods = {}): NodeId | null {
    const doc = this.doc;
    if (hit === null || !doc.nodes.has(hit)) return null;
    let h: NodeId = hit;
    if (!isElement(doc.nodes.get(h)!)) h = doc.nodes.get(h)!.parent!;
    if (h === doc.root || isLayer(doc, h)) return null;
    // khối giữ nguyên (mask, filter, pattern, svg lồng): chọn cả khối
    const block = opaqueBlockOf(doc, h);
    if (block !== null) h = block;
    if (doc.nodes.get(h)!.tag === 'tspan' && !mods.ctrl) h = doc.nodes.get(h)!.parent!;
    if (mods.ctrl) return this.canvasSelectable(h) ? h : null;
    if (this.scope !== null && !isAncestorOrSelf(doc, this.scope, h)) this.scope = null;
    const container = this.containerFor(h);
    let cur = h;
    while (doc.nodes.get(cur)!.parent !== container && doc.nodes.get(cur)!.parent !== null)
      cur = doc.nodes.get(cur)!.parent!;
    return this.canvasSelectable(cur) ? cur : null;
  }

  /** Các phần tử chọn được ở cấp hiện tại, theo thứ tự tài liệu (Tab, Ctrl+A). */
  selectableInScope(): NodeId[] {
    const doc = this.doc;
    const out: NodeId[] = [];
    const push = (id: NodeId) => {
      if (this.canvasSelectable(id)) out.push(id);
    };
    if (this.scope !== null) {
      for (const c of elementChildren(doc, this.scope)) push(c);
      return out;
    }
    for (const c of elementChildren(doc, doc.root)) {
      if (isLayer(doc, c)) {
        const st = this.env.layer(doc.nodes.get(c)!.attrs.get('data-mat-layer')!);
        if (st.hidden || st.locked) continue;
        for (const k of elementChildren(doc, c)) push(k);
      } else push(c);
    }
    return out;
  }

  /** Bỏ khỏi vùng chọn các nút không còn (sau hoàn tác, nạp lại). */
  prune(): void {
    this.selection = this.selection.filter((id) => this.doc.nodes.has(id));
    if (this.scope !== null && !this.doc.nodes.has(this.scope)) this.scope = null;
    if (
      this.currentLayer !== null &&
      !listLayers(this.doc).some((l) => l.name === this.currentLayer)
    )
      this.currentLayer = null;
    const pts = this.points();
    if (this.activePoint !== null && (!pts || this.activePoint >= pts.length))
      this.activePoint = null;
  }

  select(ids: readonly NodeId[]): void {
    this.selection = [...new Set(ids)].filter((id) => this.doc.nodes.has(id));
    this.activePoint = null;
    const first = this.selection[0];
    if (first !== undefined) this.currentLayer = layerOf(this.doc, first);
  }

  /** Chọn từ panel Lớp: được cả phần tử ở lớp khóa (FR-105). */
  selectFromPanel(id: NodeId, add = false): void {
    const doc = this.doc;
    if (!doc.nodes.has(id)) return;
    const p = doc.nodes.get(id)!.parent;
    this.scope = p !== null && p !== doc.root && !isLayer(doc, p) ? p : null;
    this.select(add ? [...this.selection.filter((x) => x !== id), id] : [id]);
  }

  selectAll(): void {
    this.select(this.selectableInScope());
  }

  /** Tab/Shift+Tab: phần tử kế/trước theo thứ tự tài liệu ở cấp hiện tại. */
  selectNext(reverse = false): void {
    const list = this.selectableInScope();
    if (!list.length) return;
    const cur = this.selection.length
      ? list.indexOf(this.selection[this.selection.length - 1])
      : -1;
    const i =
      cur < 0
        ? reverse
          ? list.length - 1
          : 0
        : (cur + (reverse ? -1 : 1) + list.length) % list.length;
    this.select([list[i]]);
  }

  /** Enter: vào nhóm đang chọn (chọn con đầu), hoặc trả về chữ để sửa. */
  enter(): 'group' | 'text' | null {
    const id = this.selection.length === 1 ? this.selection[0] : null;
    if (id === null) return null;
    const n = this.doc.nodes.get(id)!;
    if (n.tag === 'g' && opaqueBlockOf(this.doc, id) === null) {
      const kids = elementChildren(this.doc, id).filter((c) =>
        SHAPE_TAGS.has(this.doc.nodes.get(c)!.tag),
      );
      if (!kids.length) return null;
      this.scope = id;
      this.select([kids[0]]);
      return 'group';
    }
    if (n.tag === 'text' || n.tag === 'tspan') {
      this.beginTextEdit(id);
      return this.textTarget ? 'text' : null;
    }
    return null;
  }

  /** Esc: hủy thao tác dở, thoát chữ, thoát nhóm, bỏ chọn (theo thứ tự đó). Trả việc đã làm. */
  escape(): 'cancel' | 'poly' | 'text' | 'scope' | 'clear' | null {
    if (this.gesture && this.gesture.kind !== 'press') {
      this.cancelGesture();
      return 'cancel';
    }
    if (this.tool === 'poly' && this.polyPoints.length) {
      const done = this.finishPoly();
      return done ? 'poly' : 'cancel';
    }
    if (this.textTarget) return 'text';
    if (this.scope !== null) {
      const g = this.scope;
      const p = this.doc.nodes.get(g)?.parent ?? null;
      this.scope = p !== null && p !== this.doc.root && !isLayer(this.doc, p) ? p : null;
      this.select([g]);
      return 'scope';
    }
    if (this.selection.length) {
      this.select([]);
      return 'clear';
    }
    return null;
  }

  setTool(tool: ToolId): void {
    if (this.tool === 'poly' && tool !== 'poly') this.finishPoly();
    this.tool = tool;
    this.cancelGesture();
    this.activePoint = null;
  }

  // ---------- hộp bao ----------

  boxOf(id: NodeId): Box | null {
    return this.session.boxes.box(id);
  }

  selectionBox(ids: readonly NodeId[] = this.selection): Box | null {
    let acc: Box | null = null;
    for (const id of ids) {
      const b = this.boxOf(id);
      if (!b) continue;
      if (!acc) acc = { ...b };
      else {
        const x1 = Math.max(acc.x + acc.width, b.x + b.width);
        const y1 = Math.max(acc.y + acc.height, b.y + b.height);
        acc.x = Math.min(acc.x, b.x);
        acc.y = Math.min(acc.y, b.y);
        acc.width = x1 - acc.x;
        acc.height = y1 - acc.y;
      }
    }
    return acc;
  }

  // ---------- bắt dính ----------

  private snapConfig(mods: Mods, exclude: readonly NodeId[]): SnapConfig | null {
    if (mods.alt) return null;
    const s = this.snap;
    const cfg: SnapConfig = { zoom: this.zoom, grid: s.grid ? s.gridSize : null };
    const ex = new Set(exclude);
    if (s.objects) {
      const objects: SnapBox[] = [];
      for (const id of this.selectableInScope()) {
        if (ex.has(id) || exclude.some((e) => isAncestorOrSelf(this.doc, e, id))) continue;
        const b = this.boxOf(id);
        if (b) objects.push({ id, box: b });
        if (objects.length >= MAX_SNAP_OBJECTS) break;
      }
      // đường gióng cố định (thước) như cạnh của một hộp dẹt
      for (const g of this.env.guides?.() ?? [])
        objects.push({
          id: -1,
          box:
            g.axis === 'x'
              ? { x: g.pos, y: -1e6, width: 0, height: 2e6 }
              : { x: -1e6, y: g.pos, width: 2e6, height: 0 },
        });
      cfg.objects = objects;
    }
    if (s.points) cfg.points = this.endpointTargets(ex);
    return cfg;
  }

  private endpointTargets(exclude: ReadonlySet<NodeId>): SnapPointTarget[] {
    const out: SnapPointTarget[] = [];
    for (const id of this.selectableInScope()) {
      if (exclude.has(id)) continue;
      const n = this.doc.nodes.get(id)!;
      const tag = n.tag;
      if (tag === 'line') {
        const m = ctm(this.doc, id);
        const v = (k: string) => Number.parseFloat(n.attrs.get(k) ?? '0') || 0;
        out.push({ id, ...applyPoint(m, { x: v('x1'), y: v('y1') }) });
        out.push({ id, ...applyPoint(m, { x: v('x2'), y: v('y2') }) });
        continue;
      }
      if (tag !== 'polyline' && tag !== 'polygon' && tag !== 'path') continue;
      const pts = editablePoints(this.doc, id);
      if (!pts.ok || !pts.points.length) continue;
      out.push({ id, ...pts.points[0] });
      out.push({ id, ...pts.points[pts.points.length - 1] });
      if (out.length > 2 * MAX_SNAP_OBJECTS) break;
    }
    return out;
  }

  /** Bắt một điểm (vẽ, tay nắm); `anchor` cho khóa góc 15° (Shift). */
  snapAt(p: Point, mods: Mods, exclude: readonly NodeId[] = [], anchor?: Point): Point {
    this.guides = [];
    if (mods.shift && anchor && this.snap.angle) {
      const r = snapPoint(p, { zoom: this.zoom, angle: { anchor } });
      return { x: r.x, y: r.y };
    }
    const cfg = this.snapConfig(mods, exclude);
    if (!cfg) return p;
    const r = snapPoint(p, cfg);
    this.guides = r.guides;
    return { x: r.x, y: r.y };
  }

  // ---------- chuột ----------

  /** Nhấn chuột (hệ tài liệu). `hit`: nút dưới con trỏ; `handle`: tay nắm của vùng chọn hoặc điểm của Sửa nút. */
  pointerDown(
    p: Point,
    hit: NodeId | null,
    mods: Mods = {},
    handle?: HandleId | { point: number },
  ): void {
    this.message = null;
    if (this.tool === 'hand') {
      this.gesture = { kind: 'pan' };
      return;
    }
    if (this.tool === 'text') {
      const r = this.resolveHit(hit, { ctrl: true });
      const tag = r !== null ? this.doc.nodes.get(r)!.tag : null;
      if (r !== null && (tag === 'text' || tag === 'tspan')) this.beginTextEdit(r);
      else this.beginTextNew(this.snapAt(p, mods));
      return;
    }
    if (this.tool === 'poly') {
      const q = this.snapAt(p, mods, [], this.polyPoints[this.polyPoints.length - 1]);
      const first = this.polyPoints[0];
      if (first && this.polyPoints.length >= 3 && dist(q, first) * this.zoom <= CLOSE_PX) {
        this.finishPoly(true);
        return;
      }
      this.polyPoints.push(q);
      this.preview = { kind: 'poly', points: [...this.polyPoints], cursor: null };
      return;
    }
    if (this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'line') {
      const start = this.snapAt(p, mods);
      this.gesture = { kind: 'create', tool: this.tool, start, shape: null };
      return;
    }
    if (typeof handle === 'object') {
      const id = this.selection[0];
      if (id !== undefined) {
        this.activePoint = handle.point;
        this.gesture = { kind: 'point', id, index: handle.point, moved: false };
      }
      return;
    }
    if (handle && this.selection.length) {
      const ids = topLevel(this.doc, this.selection);
      const box = this.selectionBox(ids);
      if (!box) return;
      if (handle === 'rot')
        this.gesture = {
          kind: 'rotate',
          start: p,
          ids,
          center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          deg: 0,
        };
      else
        this.gesture = { kind: 'resize', handle, start: p, ids, box, matrix: [1, 0, 0, 1, 0, 0] };
      return;
    }
    const press: Gesture = { kind: 'press', start: p, hit, mods, toggleOff: null };
    this.gesture = press;
    const r = this.resolveHit(hit, mods);
    if (r === null) {
      if (!mods.shift) this.select([]);
      return;
    }
    if (mods.shift) {
      // Shift+nhấp: thêm ngay; bớt khi thả (Shift+kéo phần tử đã chọn là kéo khóa trục)
      if (this.selection.includes(r)) press.toggleOff = r;
      else this.select([...this.selection, r]);
      return;
    }
    if (!this.selection.includes(r)) this.select([r]);
  }

  pointerMove(p: Point, mods: Mods = {}): void {
    const g = this.gesture;
    if (this.tool === 'poly' && this.polyPoints.length && !g) {
      const q = this.snapAt(p, mods, [], this.polyPoints[this.polyPoints.length - 1]);
      this.preview = { kind: 'poly', points: [...this.polyPoints], cursor: q };
      return;
    }
    if (!g) return;
    switch (g.kind) {
      case 'press': {
        if (dist(p, g.start) * this.zoom < DRAG_PX) return;
        if (
          this.tool === 'node' ||
          this.selection.length === 0 ||
          this.resolveHit(g.hit, g.mods) === null
        ) {
          if (this.tool === 'node' && this.selection.length) return;
          this.gesture = {
            kind: 'marquee',
            start: g.start,
            additive: !!g.mods.shift,
            box: boxOf(g.start.x, g.start.y, p.x, p.y),
          };
          this.pointerMove(p, mods);
          return;
        }
        const ids = topLevel(this.doc, this.selection);
        const box = this.selectionBox(ids);
        if (!box) return;
        this.gesture = { kind: 'move', start: g.start, ids, box, dx: 0, dy: 0 };
        this.pointerMove(p, mods);
        return;
      }
      case 'move': {
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (mods.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const cfg = this.snapConfig(mods, g.ids);
        this.guides = [];
        if (cfg) {
          const r = snapMove(g.box, dx, dy, cfg);
          if (!mods.shift || dx !== 0) dx = r.dx;
          if (!mods.shift || dy !== 0) dy = r.dy;
          this.guides = r.guides;
        }
        g.dx = dx;
        g.dy = dy;
        this.preview = {
          kind: 'transform',
          ids: g.ids,
          matrix: translateM(dx, dy),
          quick: g.ids.length >= QUICK_PREVIEW_NODES,
        };
        return;
      }
      case 'resize': {
        g.matrix = this.resizeMatrix(g.handle, g.box, p, mods, g.ids);
        this.preview = {
          kind: 'transform',
          ids: g.ids,
          matrix: g.matrix,
          quick: g.ids.length >= QUICK_PREVIEW_NODES,
        };
        return;
      }
      case 'rotate': {
        const a0 = Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x);
        const a1 = Math.atan2(p.y - g.center.y, p.x - g.center.x);
        let deg = ((a1 - a0) * 180) / Math.PI;
        if (mods.shift && this.snap.angle) deg = Math.round(deg / 15) * 15;
        g.deg = deg;
        this.preview = {
          kind: 'transform',
          ids: g.ids,
          matrix: rotateM(deg, g.center.x, g.center.y),
          quick: g.ids.length >= QUICK_PREVIEW_NODES,
        };
        return;
      }
      case 'marquee':
        g.box = boxOf(g.start.x, g.start.y, p.x, p.y);
        this.preview = { kind: 'marquee', box: g.box };
        return;
      case 'create': {
        const q = this.snapAt(p, mods, [], g.tool === 'line' ? g.start : undefined);
        g.shape = this.shapeFrom(g.tool, g.start, q, mods);
        this.preview = g.shape ? { kind: 'shape', shape: g.shape } : null;
        return;
      }
      case 'point': {
        const q = this.snapAt(p, mods, [g.id]);
        try {
          const r = this.session.apply(
            this.withKey(setPoint(this.doc, g.id, g.index, q), `pt:${g.id}:${g.index}`),
          );
          if (!r.ok) this.message = r.error?.message ?? null;
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          this.message = e.message;
        }
        g.moved = true;
        return;
      }
      case 'pan':
        return;
    }
  }

  /** Thả chuột: áp lô của thao tác (một bước hoàn tác). */
  pointerUp(p: Point, mods: Mods = {}): ApplyResult | null {
    const g = this.gesture;
    this.gesture = null;
    this.preview = this.tool === 'poly' ? this.preview : null;
    this.guides = [];
    if (!g) return null;
    switch (g.kind) {
      case 'press':
        if (g.toggleOff !== null) this.select(this.selection.filter((x) => x !== g.toggleOff));
        return null;
      case 'move':
        if (g.dx === 0 && g.dy === 0) return null;
        return this.commit(moveNodes(this.doc, g.ids, g.dx, g.dy));
      case 'resize': {
        const t = transformNodes(this.doc, g.ids, g.matrix, 'Đổi cỡ');
        return this.commit(t);
      }
      case 'rotate':
        if (g.deg === 0) return null;
        return this.commit(rotateNodes(this.doc, g.ids, g.deg, g.center.x, g.center.y));
      case 'marquee': {
        const hits = this.selectableInScope().filter((id) => {
          const b = this.boxOf(id);
          return b !== null && contains(g.box, b);
        });
        this.select(g.additive ? [...this.selection, ...hits] : hits);
        return null;
      }
      case 'create': {
        const q = this.snapAt(p, mods, [], g.tool === 'line' ? g.start : undefined);
        const shape = this.shapeFrom(g.tool, g.start, q, mods);
        this.guides = [];
        if (!shape) return null;
        return this.createShape(shape);
      }
      case 'point':
        this.session.endGesture();
        return null;
      case 'pan':
        return null;
    }
  }

  cancelGesture(): void {
    if (this.gesture?.kind === 'point') this.session.endGesture();
    this.gesture = null;
    this.preview = null;
    this.guides = [];
    if (this.tool !== 'poly') this.polyPoints = [];
  }

  /** Đang kéo (giao diện chặn cuộn, đổi con trỏ). */
  get dragging(): boolean {
    return this.gesture !== null && this.gesture.kind !== 'press';
  }

  /** Nhấp đúp: vào nhóm, sửa chữ, thêm nút trên cạnh (Sửa nút), xong đa tuyến. */
  doubleClick(p: Point, hit: NodeId | null): 'group' | 'text' | 'point' | 'poly' | null {
    if (this.tool === 'poly') return this.finishPoly() ? 'poly' : null;
    if (this.tool === 'node' && this.selection.length === 1) {
      const id = this.selection[0];
      const pts = editablePoints(this.doc, id);
      if (pts.ok && pts.points.length >= 2) {
        const seg = nearestSegment(pts.points, p, pts.closed);
        if (seg.index >= 0 && seg.distance * this.zoom <= CLOSE_PX) {
          const r = this.attempt(
            () => new Batch([insertPoint(this.doc, id, seg.index, p)], { label: 'Thêm nút' }),
          );
          if (r.ok) this.activePoint = seg.index + 1;
          return r.ok ? 'point' : null;
        }
      }
    }
    const r = this.resolveHit(hit);
    if (r === null) return null;
    this.select([r]);
    const tag = this.doc.nodes.get(r)!.tag;
    if (tag === 'g') {
      // vào nhóm rồi chọn phần tử con dưới con trỏ
      this.scope = r;
      const inner = this.resolveHit(hit);
      this.select([inner ?? r]);
      return 'group';
    }
    if (tag === 'text') {
      this.beginTextEdit(hit !== null && this.doc.nodes.get(hit)?.tag === 'tspan' ? hit : r);
      return this.textTarget ? 'text' : null;
    }
    return null;
  }

  // ---------- hình mới ----------

  private resizeMatrix(handle: HandleId, box: Box, p: Point, mods: Mods, ids: NodeId[]): Matrix {
    const q = this.snapAt(p, mods, ids);
    const x0 = box.x;
    const y0 = box.y;
    const x1 = box.x + box.width;
    const y1 = box.y + box.height;
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const ox = mods.alt ? cx : west ? x1 : x0;
    const oy = mods.alt ? cy : north ? y1 : y0;
    const w = box.width || 1e-9;
    const h = box.height || 1e-9;
    let sx = 1;
    let sy = 1;
    if (east || west) sx = ((west ? ox - q.x : q.x - ox) * (mods.alt ? 2 : 1)) / w;
    if (north || south) sy = ((north ? oy - q.y : q.y - oy) * (mods.alt ? 2 : 1)) / h;
    const corner = (east || west) && (north || south);
    if (mods.shift) {
      if (corner) {
        const s = Math.max(Math.abs(sx), Math.abs(sy));
        sx = s;
        sy = s;
      } else if (east || west) sy = Math.abs(sx);
      else sx = Math.abs(sy);
    }
    const min = 1e-3;
    sx = Math.max(min, sx);
    sy = Math.max(min, sy);
    return scaleM(sx, sy, ox, oy);
  }

  private shapeFrom(
    tool: 'rect' | 'ellipse' | 'line',
    a: Point,
    b: Point,
    mods: Mods,
  ): ShapeInput | null {
    if (tool === 'line') {
      if (dist(a, b) < MIN_SHAPE) return null;
      return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    let w = b.x - a.x;
    let h = b.y - a.y;
    if (mods.shift) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * s;
      h = Math.sign(h || 1) * s;
    }
    const box = mods.alt
      ? boxOf(a.x - w, a.y - h, a.x + w, a.y + h)
      : boxOf(a.x, a.y, a.x + w, a.y + h);
    if (box.width < MIN_SHAPE || box.height < MIN_SHAPE) return null;
    if (tool === 'rect')
      return { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (mods.shift) return { kind: 'circle', cx, cy, r: box.width / 2 };
    return { kind: 'ellipse', cx, cy, rx: box.width / 2, ry: box.height / 2 };
  }

  /** Cha nhận phần tử mới: nhóm đang vào, lớp hiện tại, hoặc gốc. */
  private targetParent(): NodeId | string {
    if (this.scope !== null) return this.scope;
    if (this.currentLayer === null) {
      if (this.env.layer(null).locked) return 'Lớp mặc định đang khóa';
      return this.doc.root;
    }
    const st = this.env.layer(this.currentLayer);
    if (st.locked || st.hidden)
      return `Lớp "${this.currentLayer}" đang ${st.locked ? 'khóa' : 'ẩn'}`;
    return listLayers(this.doc).find((l) => l.name === this.currentLayer)?.id ?? this.doc.root;
  }

  createShape(shape: ShapeInput): ApplyResult {
    const parent = this.targetParent();
    if (typeof parent === 'string') {
      this.message = parent;
      return { ok: false, targets: [] };
    }
    const c = createShape(this.doc, shape, parent);
    const r = this.session.apply(c.batch);
    if (r.ok) {
      this.select([c.id]);
      if (c.warning) this.message = c.warning;
    } else this.message = r.error?.message ?? null;
    return r;
  }

  /** Xong đa tuyến (Enter, nhấp đúp) hoặc đa giác (`close`, nhấp lại điểm đầu). */
  finishPoly(close = false): ApplyResult | null {
    const pts = this.polyPoints;
    this.polyPoints = [];
    this.preview = null;
    if (pts.length < 2 || (close && pts.length < 3)) return null;
    return this.createShape({
      kind: close ? 'polygon' : 'polyline',
      points: pts.map((q) => [q.x, q.y] as [number, number]),
    });
  }

  // ---------- chữ ----------

  private beginTextNew(p: Point): void {
    this.textTarget = { mode: 'new', x: p.x, y: p.y, text: '', fontSize: 16 };
  }

  beginTextEdit(id: NodeId): void {
    const doc = this.doc;
    const n = doc.nodes.get(id);
    if (!n) return;
    const hasTspan = n.children.some((c) => doc.nodes.get(c)?.tag === 'tspan');
    if (n.tag === 'text' && hasTspan) {
      // chữ có tspan: sửa tspan đầu tiên (không tạo tspan mới, FR-108)
      const first = n.children.find((c) => doc.nodes.get(c)?.tag === 'tspan')!;
      return this.beginTextEdit(first);
    }
    const b = this.boxOf(n.tag === 'tspan' ? n.parent! : id);
    const size = Number.parseFloat(n.attrs.get('font-size') ?? '') || 16;
    this.textTarget = {
      mode: 'edit',
      id,
      x: b ? b.x : 0,
      y: b ? b.y + b.height * 0.8 : 0,
      text: textOf(doc, id),
      fontSize: size,
    };
    this.select([n.tag === 'tspan' ? (n.parent ?? id) : id]);
  }

  /** Xong ô chữ (Enter, Esc, mất focus): chữ mới thành `text`, chữ sửa thành SetText; rỗng không tạo gì. */
  commitText(value: string): ApplyResult | null {
    const tt = this.textTarget;
    this.textTarget = null;
    if (!tt) return null;
    const text = value.replace(/[\r\n]+/g, ' ');
    if (tt.mode === 'new') {
      if (text.trim() === '') return null;
      return this.createShape({ kind: 'text', x: tt.x, y: tt.y, text });
    }
    if (text === tt.text || tt.id === undefined) return null;
    const r = this.session.apply(new Batch([new SetText(tt.id, text)], { label: 'Sửa chữ' }));
    if (!r.ok) this.message = r.error?.message ?? null;
    return r;
  }

  cancelText(): void {
    this.textTarget = null;
  }

  // ---------- Sửa nút ----------

  /** Điểm của phần tử đang chọn (công cụ Sửa nút) hoặc lý do khóa. */
  points(): Point[] | null {
    if (this.selection.length !== 1) return null;
    const pts = editablePoints(this.doc, this.selection[0]);
    return pts.ok ? pts.points : null;
  }

  nodeLockReason(): string | null {
    if (this.selection.length !== 1) return null;
    const pts = editablePoints(this.doc, this.selection[0]);
    return pts.ok ? null : pts.reason;
  }

  deleteActivePoint(): ApplyResult | null {
    if (this.activePoint === null || this.selection.length !== 1) return null;
    const id = this.selection[0];
    const i = this.activePoint;
    const r = this.attempt(() => new Batch([deletePoint(this.doc, id, i)], { label: 'Xóa nút' }));
    this.activePoint = null;
    return r;
  }

  /** Đóng/mở đa tuyến ↔ đa giác. */
  toggleClosed(): ApplyResult | null {
    if (this.selection.length !== 1) return null;
    const id = this.selection[0];
    const pts = editablePoints(this.doc, id);
    if (!pts.ok) return null;
    const r = this.attempt(() => setClosed(this.doc, id, !pts.closed));
    return r;
  }

  // ---------- lệnh trên vùng chọn ----------

  private withKey(cmd: Command, key: string): Command {
    cmd.mergeKey = key;
    return cmd;
  }

  /** Áp kết quả của một hàm tạo lô; lỗi của hàm (CommandError) thành lời nhắn. */
  private attempt(make: () => { batch: Batch; id?: NodeId; ids?: NodeId[] } | Batch): ApplyResult {
    try {
      const made = make();
      const batch = made instanceof Batch ? made : made.batch;
      if (batch.commands.length === 0) return { ok: true, targets: [] };
      const r = this.session.apply(batch);
      if (!r.ok) this.message = r.error?.message ?? null;
      else if (!(made instanceof Batch)) {
        if (made.ids) this.select(made.ids);
        else if (made.id !== undefined) this.select([made.id]);
      }
      return r;
    } catch (e) {
      if (e instanceof CommandError) {
        this.message = e.message;
        return { ok: false, targets: [], error: e };
      }
      throw e;
    }
  }

  private commit(t: { batch: Batch; replaced: Map<NodeId, NodeId> }): ApplyResult {
    const r = this.attempt(() => t.batch);
    if (r.ok && t.replaced.size)
      this.selection = this.selection.map((id) => t.replaced.get(id) ?? id);
    return r;
  }

  /** Mũi tên: dịch (Shift 10, Ctrl theo lưới); giữ phím là một bước (gộp đến `endNudge`). */
  nudge(dx: number, dy: number): ApplyResult | null {
    if (!this.selection.length) return null;
    const ids = topLevel(this.doc, this.selection);
    const t = moveNodes(this.doc, ids, dx, dy);
    t.batch.mergeKey = 'nudge';
    return this.commit(t);
  }

  endNudge(): void {
    this.session.endGesture();
  }

  /** Xóa: trả lô và uid trong các cây con bị xóa (giao diện cảnh báo binding, FR-110) mà CHƯA áp. */
  planDelete(): { batch: Batch; uids: string[] } | null {
    const ids = topLevel(this.doc, this.selection);
    if (!ids.length) return null;
    return deleteNodes(this.doc, ids);
  }

  applyDelete(batch: Batch): ApplyResult {
    const r = this.attempt(() => batch);
    if (r.ok) this.select([]);
    return r;
  }

  duplicate(): ApplyResult | null {
    if (!this.selection.length) return null;
    return this.attempt(() => duplicateNodes(this.doc, this.selection, 20));
  }

  copy(): ClipData | null {
    if (!this.selection.length) return null;
    return copyNodes(this.doc, this.selection);
  }

  private pasteTarget(): { parent: NodeId } | string {
    const p = this.targetParent();
    return typeof p === 'string' ? p : { parent: p };
  }

  paste(clip: ClipData, offset = 20): ApplyResult | null {
    const t = this.pasteTarget();
    if (typeof t === 'string') {
      this.message = t;
      return null;
    }
    return this.attempt(() =>
      pasteClip(this.doc, clip, { parent: t.parent, offset: { dx: offset, dy: offset } }),
    );
  }

  /** Dán SVG dạng chữ từ clipboard hệ thống: qua bộ nhập và allowlist; trả báo cáo đã loại. */
  pasteText(text: string): PasteTextResult | null {
    const t = this.pasteTarget();
    if (typeof t === 'string') {
      this.message = t;
      return null;
    }
    const r = pasteSvgText(this.doc, text, { parent: t.parent });
    if (!r.ok) {
      this.message = r.message;
      return r;
    }
    const a = this.attempt(() => r);
    return a.ok ? r : { ok: false, code: 'SVG_LIMIT', message: a.error?.message ?? '' };
  }

  group(): ApplyResult | null {
    if (!this.selection.length) return null;
    return this.attempt(() => {
      const g = groupNodes(this.doc, this.selection);
      return { batch: g.batch, id: g.group };
    });
  }

  ungroup(): ApplyResult | null {
    const id = this.selection.length === 1 ? this.selection[0] : null;
    if (id === null || this.doc.nodes.get(id)?.tag !== 'g') {
      this.message = 'Chọn một nhóm để bỏ nhóm';
      return null;
    }
    return this.attempt(() => {
      const u = ungroupNode(this.doc, id);
      return { batch: u.batch, ids: u.children };
    });
  }

  order(kind: 'front' | 'back' | 'forward' | 'backward'): ApplyResult | null {
    if (!this.selection.length) return null;
    const f = {
      front: bringToFront,
      back: sendToBack,
      forward: bringForward,
      backward: sendBackward,
    }[kind];
    return this.attempt(() => f(this.doc, this.selection));
  }

  align(mode: AlignMode, reference: 'selection' | 'first' = 'selection'): ApplyResult | null {
    if (this.selection.length < 2) {
      this.message = 'Chọn ít nhất 2 phần tử để căn';
      return null;
    }
    return this.attempt(() => alignNodes(this.doc, this.selection, mode, reference));
  }

  distribute(axis: 'h' | 'v'): ApplyResult | null {
    if (this.selection.length < 3) {
      this.message = 'Chọn ít nhất 3 phần tử để phân bố';
      return null;
    }
    return this.attempt(() => distributeNodes(this.doc, this.selection, axis));
  }

  sameSize(dim: 'width' | 'height'): ApplyResult | null {
    if (this.selection.length < 2) {
      this.message = 'Chọn ít nhất 2 phần tử (phần tử chọn đầu là mẫu)';
      return null;
    }
    return this.attempt(() => sameSizeNodes(this.doc, this.selection, dim));
  }

  /** Lô đặt thuộc tính cho vùng chọn (inspector). */
  setAttrs(
    changes: ReadonlyArray<[NodeId, string, string | null]>,
    label: string,
    mergeKey?: string,
  ): ApplyResult {
    const cmds = changes
      .filter(([id, name, v]) => (this.doc.nodes.get(id)?.attrs.get(name) ?? null) !== v)
      .map(([id, name, v]) => new SetAttr(id, name, v));
    if (!cmds.length) return { ok: true, targets: [] };
    const b = new Batch(cmds, { label, ...(mergeKey ? { mergeKey } : {}) });
    return this.attempt(() => b);
  }

  /** Lô biến đổi (inspector: X, Y, Rộng, Cao, Góc). */
  transformSelection(m: Matrix, label: string): ApplyResult | null {
    if (!this.selection.length) return null;
    return this.commit(transformNodes(this.doc, topLevel(this.doc, this.selection), m, label));
  }

  // ---------- lớp ----------

  addLayer(name?: string): ApplyResult {
    const taken = new Set(listLayers(this.doc).map((l) => l.name));
    let n = name ?? '';
    if (!name) for (let i = 1; ; i++) if (!taken.has((n = `Lớp ${i}`))) break;
    const r = this.attempt(() => createLayer(this.doc, n));
    if (r.ok) {
      this.currentLayer = n;
      this.select([]);
    }
    return r;
  }

  renameLayer(name: string, to: string): ApplyResult {
    const r = this.attempt(() => renameLayer(this.doc, name, to.trim()));
    if (r.ok && this.currentLayer === name) this.currentLayer = to.trim();
    return r;
  }

  planDeleteLayer(
    name: string,
    mode: 'content' | 'move',
  ): { batch: Batch; uids: string[] } | string {
    try {
      return deleteLayer(this.doc, name, mode);
    } catch (e) {
      if (e instanceof CommandError) return e.message;
      throw e;
    }
  }

  /** `delta` > 0: lên trên. */
  moveLayer(name: string, delta: number): ApplyResult | null {
    const list = listLayers(this.doc);
    const i = list.findIndex((l) => l.name === name);
    if (i < 0) return null;
    const j = Math.max(0, Math.min(list.length - 1, i + delta));
    if (i === j) return null;
    return this.attempt(() => reorderLayer(this.doc, name, j));
  }

  moveSelectionToLayer(name: string | null): ApplyResult | null {
    if (!this.selection.length) return null;
    const ids = topLevel(this.doc, this.selection);
    const r = this.commit(moveToLayer(this.doc, ids, name));
    if (r.ok) {
      this.currentLayer = name;
      this.scope = null;
    }
    return r;
  }

  /** Tên hiển thị (`data-mat-name`) — F2. */
  rename(id: NodeId, name: string): ApplyResult {
    return this.setAttrs(
      [[id, 'data-mat-name', name.trim() === '' ? null : name.trim()]],
      'Đổi tên',
    );
  }

  /** Mô tả ngắn của phần tử (panel Lớp, thanh trạng thái): tên hiển thị, id, hoặc thẻ. */
  label(id: NodeId): string {
    const n = this.doc.nodes.get(id);
    if (!n) return '';
    const name = n.attrs.get('data-mat-name') ?? n.attrs.get('inkscape:label');
    if (name) return name;
    if (n.tag === 'text') {
      const t =
        textOf(this.doc, id) ||
        elementChildren(this.doc, id)
          .map((c) => textOf(this.doc, c))
          .join('');
      if (t.trim()) return `"${t.trim().slice(0, 40)}"`;
    }
    return n.attrs.get('id') ?? n.tag;
  }
}

/** Định dạng số cho ô nhập (≤ 3 chữ số thập phân, như bộ ghi). */
export const num = (v: number): string => fmt(v);
