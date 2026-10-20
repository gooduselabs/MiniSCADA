// Sơ đồ khối của editor Logic (feature 015; specs/015-logic-ui): khung nhìn của logic.json vẽ bằng SVG (Lit `svg`, không
// thư viện, không innerHTML). Đồ thị là hàm thuần (model/logic-graph.ts); mọi sửa qua `logicSet` / `logicLayoutSet` của store
// (một bước hoàn tác mỗi thao tác). Kéo khối (lưới 16 px), kéo cổng ra tới cổng vào để nối dây (sửa biểu thức), chọn để sửa ở
// Inspector cũ, zoom/pan, Vừa khung, Tự sắp xếp, bản đồ nhỏ; thả khối/cổng/Tag từ task card. Thử logic (LogicSim dùng chung)
// và Online (giá trị sống, GET /logic) hiện giá trị trên dây và cổng. Lỗi lấy từ validator (cellMarks). Bàn phím: Tab giữa các
// khối, mũi tên dịch, Delete, Ctrl+D, Enter, + − 0.
import { html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import {
  compile,
  evaluate,
  type InputValue,
  type Program,
  type TagDataType,
} from '@mat/expression';
import { t, type MessageKey } from '../../i18n/index.ts';
import { iconHref } from '../../icons/icons.ts';
import { PRIORITY } from '../../model/live-subscriptions.ts';
import { blocksOf, findBlock, outputTagsOf, type Block } from '../../model/logic-doc.ts';
import {
  GEOM,
  buildLogicGraph,
  type GNode,
  type GPort,
  type LogicGraph,
  type Wire,
} from '../../model/logic-graph.ts';
import {
  connectAction,
  duplicateBlock,
  removeWire,
  setSlot,
  wrapSlot,
  type GateTool,
} from '../../model/logic-graph-edit.ts';
import {
  LAYOUT_GRID,
  emptyLayout,
  placeNodes,
  pruneLayout,
  snap,
  type LogicLayoutDoc,
  type NodePos,
} from '../../model/logic-layout.ts';
import { AppElement, icon } from '../base.ts';
import { LOGIC_BLOCK_MIME, LOGIC_GATE_MIME, dropLogicBlock } from './logic-card.ts';
import { KIND_ICON, kindLabel, num } from './logic-parts.ts';
import {
  cellMarks,
  editLayout,
  editLogic,
  isKind,
  kindOf,
  liveOnline,
  logicDoc,
  logicIssues,
  logicLayout,
  logicSim,
  logicUi,
  onSimChange,
  projectTags,
  removeLogicBlock,
  select,
  selectedId,
  setKind,
  tableNames,
} from './logic-state.ts';
import './logic-diagram.css';

const Z_MIN = 0.25;
const Z_MAX = 2;
const FIRE_MS = 900;
const MINI_W = 168;
const MINI_H = 104;

interface View {
  z: number;
  tx: number;
  ty: number;
}

type Drag =
  | {
      mode: 'node';
      key: string;
      pid: number;
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      dx: number;
      dy: number;
      moved: boolean;
    }
  | { mode: 'pan'; pid: number; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | {
      mode: 'wire';
      pid: number;
      from: { node: string; port: string };
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      type: string;
      action: boolean;
    }
  | { mode: 'mini'; pid: number };

/** Giá trị sống của một Tag hoặc một cổng (null: không có nguồn). */
interface LiveVal {
  value: boolean | number | string | bigint | null;
  quality: string;
}

interface BlockLive {
  state: string;
  reason?: string | null;
  /** Đếm cạnh (Thử logic: edgeId) hoặc số lần bắn (Online): đổi là vừa bắn. */
  fired?: number;
  firedText?: string;
}

const fmtSeconds = (ms: number): string =>
  ms >= 60_000 && ms % 60_000 === 0 ? `${num(ms / 60_000)} min` : `${num(ms / 1000)} s`;

const fmtVal = (v: LiveVal | null): string => {
  if (!v || v.value === null) return '—';
  if (v.quality === 'BAD') return 'BAD';
  if (typeof v.value === 'number') return num(v.value);
  if (typeof v.value === 'bigint') return v.value.toString();
  return String(v.value);
};

const isTrue = (v: LiveVal | null) => !!v && v.quality === 'GOOD' && v.value === true;

export class LogicDiagram extends AppElement {
  private drag: Drag | null = null;
  private selWire: string | null = null;
  private hoverPort: string | null = null;
  private graphMemo: {
    doc: unknown;
    layout: unknown;
    tags: unknown;
    marks: unknown;
    g: LogicGraph;
  } | null = null;
  private fired = new Map<string, { n: number; at: number }>();
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
  private progs = new Map<string, Program | null>();
  private progsKey: unknown = null;
  private offSim: (() => void) | null = null;
  private offValues: (() => void) | null = null;
  private declared = '';
  private raf = 0;
  private lastSel: string | null = null;
  private resizeObs: ResizeObserver | null = null;
  private size = { w: 0, h: 0 };

  protected override attached(): void {
    const app = this.app;
    this.offSim = onSimChange(app, () => this.schedule());
    this.offValues = app.subscribeValues(() => {
      if (liveOnline(app)) this.schedule();
    });
  }

  protected override detached(): void {
    this.offSim?.();
    this.offSim = null;
    this.offValues?.();
    this.offValues = null;
    if (this.declared) this.app.live.release('logic-diagram');
    this.declared = '';
    if (this.fireTimer) clearTimeout(this.fireTimer);
    this.fireTimer = null;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
  }

  /** Gộp các lần báo giá trị trong một khung hình. */
  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.requestUpdate();
    });
  }

  // ---------- Đồ thị, khung nhìn ----------

  graph(): LogicGraph | null {
    const app = this.app;
    const doc = logicDoc(app);
    if (!doc) return null;
    const layout = logicLayout(app) ?? emptyLayout();
    const tags = projectTags(app);
    logicIssues(app);
    const marks = logicUi(app).check;
    const m = this.graphMemo;
    if (m && m.doc === doc && m.layout === layout && m.tags === tags && m.marks === marks)
      return m.g;
    const g = buildLogicGraph(doc, { tags, layout, marks: cellMarks(app) });
    this.graphMemo = { doc, layout, tags, marks, g };
    return g;
  }

  private get view(): View {
    const ui = logicUi(this.app);
    return ui.dview ?? { z: 1, tx: GEOM.margin, ty: GEOM.margin };
  }

  private setViewport(v: View): void {
    logicUi(this.app).dview = {
      z: Math.max(Z_MIN, Math.min(Z_MAX, v.z)),
      tx: Math.round(v.tx),
      ty: Math.round(v.ty),
    };
    this.requestUpdate();
  }

  private viewEl(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.lgd-view');
  }

  /** Vừa khung: cả sơ đồ trong vùng nhìn (tối đa 100 %). */
  fit(maxZ = 1): void {
    const g = this.graph();
    const el = this.viewEl();
    if (!g || !el) return;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 400;
    const b = g.bounds;
    if (b.w === 0) {
      this.setViewport({ z: 1, tx: GEOM.margin, ty: GEOM.margin });
      return;
    }
    const z = Math.max(Z_MIN, Math.min(maxZ, (w - 48) / b.w, (h - 48) / b.h));
    this.setViewport({ z, tx: (w - b.w * z) / 2 - b.x * z, ty: (h - b.h * z) / 2 - b.y * z });
  }

  zoomBy(f: number, cx?: number, cy?: number): void {
    const el = this.viewEl();
    const v = this.view;
    const px = cx ?? (el?.clientWidth ?? 800) / 2;
    const py = cy ?? (el?.clientHeight ?? 400) / 2;
    const z = Math.max(Z_MIN, Math.min(Z_MAX, v.z * f));
    const k = z / v.z;
    this.setViewport({ z, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k });
  }

  /** Tâm vùng nhìn theo tọa độ sơ đồ (thêm khối bằng menu/Insert khi đang ở Sơ đồ). */
  centerPos(): NodePos {
    const el = this.viewEl();
    const v = this.view;
    const x = ((el?.clientWidth ?? 800) / 2 - v.tx) / v.z - GEOM.blockW / 2;
    const y = ((el?.clientHeight ?? 400) / 2 - v.ty) / v.z - 40;
    return { x: snap(x), y: snap(y) };
  }

  private toDiagram(clientX: number, clientY: number): NodePos {
    const r = this.viewEl()?.getBoundingClientRect();
    const v = this.view;
    return {
      x: (clientX - (r?.left ?? 0) - v.tx) / v.z,
      y: (clientY - (r?.top ?? 0) - v.ty) / v.z,
    };
  }

  /** Đưa nút vào vùng nhìn (chọn từ danh sách lỗi, Tab). */
  private reveal(n: GNode): void {
    const el = this.viewEl();
    if (!el || !el.clientWidth) return;
    const v = this.view;
    const x0 = n.x * v.z + v.tx;
    const y0 = n.y * v.z + v.ty;
    const x1 = x0 + n.w * v.z;
    const y1 = y0 + n.h * v.z;
    if (x0 >= 8 && y0 >= 8 && x1 <= el.clientWidth - 8 && y1 <= el.clientHeight - 8) return;
    this.setViewport({
      ...v,
      tx: el.clientWidth / 2 - (n.x + n.w / 2) * v.z,
      ty: el.clientHeight / 2 - (n.y + n.h / 2) * v.z,
    });
  }

  // ---------- Chọn ----------

  /** Khóa nút đang chọn: Tag/Tag đích theo `dsel`, khối theo nhóm đang mở. */
  private selKey(): string | null {
    const ui = logicUi(this.app);
    if (ui.dsel) return ui.dsel;
    return selectedId(this.app, kindOf(this.app));
  }

  private selectNode(n: GNode, focusField?: string): void {
    const app = this.app;
    const ui = logicUi(app);
    this.selWire = null;
    if (n.type === 'block' || n.owner) {
      const kind = n.kind!;
      const id = n.owner ?? n.id!;
      if (kindOf(app) !== kind) setKind(app, kind);
      select(app, kind, id);
      const field = focusField ?? (n.owner ? n.slot?.field : undefined);
      if (field) ui.focus = { id, field };
    } else {
      ui.dsel = n.key;
      app.requestRender();
    }
    this.requestUpdate();
  }

  // ---------- Sửa ----------

  private get ro(): boolean {
    return this.app.store.state.readOnly;
  }

  private moveNodes(entries: Record<string, NodePos>, merge?: string): void {
    editLayout(this.app, placeNodes(this.layoutWithAll(), entries), merge);
  }

  /** Layout có vị trí của MỌI nút đang vẽ (để nút tự xếp không nhảy khi một nút khác được đặt). */
  private layoutWithAll(): LogicLayoutDoc {
    const g = this.graph();
    const cur = logicLayout(this.app) ?? emptyLayout();
    if (!g) return cur;
    const all: Record<string, NodePos> = {};
    for (const n of g.nodes) if (n.movable && !cur.nodes[n.key]) all[n.key] = { x: n.x, y: n.y };
    const keep = new Set(g.nodes.filter((n) => n.movable).map((n) => n.key));
    return pruneLayout(placeNodes(cur, all), keep);
  }

  arrange(): void {
    const app = this.app;
    const doc = logicDoc(app);
    if (!doc || this.ro) return;
    const g = buildLogicGraph(doc, { tags: projectTags(app), layout: emptyLayout() });
    const nodes: Record<string, NodePos> = {};
    for (const n of g.nodes) if (n.movable) nodes[n.key] = { x: n.x, y: n.y };
    const next = { ...emptyLayout(), nodes };
    const cur = (logicLayout(app) ?? emptyLayout()).nodes;
    const same =
      Object.keys(cur).length === Object.keys(nodes).length &&
      Object.entries(nodes).every(([k, p]) => cur[k]?.x === p.x && cur[k]?.y === p.y);
    if (!same) {
      editLayout(app, next);
      app.toast(t('lgd.t.arranged'));
    }
    requestAnimationFrame(() => this.fit());
  }

  private deleteSelection(): void {
    const app = this.app;
    const doc = logicDoc(app);
    const g = this.graph();
    if (!doc || !g || this.ro) return;
    if (this.selWire) {
      const w = g.wires.find((x) => x.key === this.selWire);
      this.selWire = null;
      if (w) editLogic(app, removeWire(doc, g, w));
      return;
    }
    const key = this.selKey();
    const n = key ? g.byKey.get(key) : undefined;
    if (!n) return;
    if (n.type !== 'block') {
      app.toast(t('lgd.t.derived'));
      return;
    }
    const kind = n.kind!;
    const list = blocksOf(doc, kind);
    const i = list.findIndex((b) => b.id === n.id);
    removeLogicBlock(app, kind, n.id!);
    select(app, kind, list[i + 1]?.id ?? list[i - 1]?.id ?? null);
    requestAnimationFrame(() => this.focusNode(this.selKey()));
  }

  private duplicate(): void {
    const app = this.app;
    const doc = logicDoc(app);
    const g = this.graph();
    const key = this.selKey();
    const n = key ? g?.byKey.get(key) : undefined;
    if (!doc || !n || n.type !== 'block' || this.ro) return;
    const r = duplicateBlock(doc, n.kind!, n.id!);
    const layout = placeNodes(this.layoutWithAll(), { [r.id]: { x: n.x + 32, y: n.y + 32 } });
    editLogic(app, r.doc, undefined, layout);
    select(app, n.kind!, r.id);
    requestAnimationFrame(() => this.focusNode(r.id));
  }

  private connect(from: { node: string; port: string }, target: Element | null): void {
    const app = this.app;
    const doc = logicDoc(app);
    const g = this.graph();
    if (!doc || !g || this.ro) return;
    const src = g.byKey.get(from.node);
    const sp = src?.ports.find((p) => p.key === from.port);
    if (!src || !sp) return;
    const pinEl = target?.closest<SVGElement>('[data-pin]');
    const nodeEl = target?.closest<SVGElement>('[data-node]');
    const toNode = (pinEl ?? nodeEl)?.dataset.node;
    const tn = toNode ? g.byKey.get(toNode) : undefined;
    // luật ↑/↓ → Ghi PLC hoặc Tag
    if (src.type === 'block' && src.kind === 'rule' && (sp.key === 'rise' || sp.key === 'fall')) {
      const edge = sp.key === 'rise' ? 'onRise' : 'onFall';
      if (tn?.type === 'block' && tn.kind === 'writes')
        editLogic(app, connectAction(doc, src.id!, edge, { writes: tn.id! }));
      else if ((tn?.type === 'out' || tn?.type === 'tag') && tn.id)
        editLogic(app, connectAction(doc, src.id!, edge, { tag: tn.id }));
      else app.toast(t(tn ? 'lgd.t.actionOnly' : 'lgd.t.noTarget'));
      return;
    }
    const tag = sp.tag;
    if (!tag || !tn || tn.key === src.key) {
      if (tn && tn.key !== src.key) app.toast(t('lgd.t.noTarget'));
      return;
    }
    let port: GPort | undefined;
    if (pinEl) port = tn.ports.find((p) => p.key === pinEl.dataset.pin && p.side === 'in');
    else
      port =
        tn.ports.find((p) => p.side === 'in' && p.slot && p.text === '') ??
        tn.ports.find((p) => p.side === 'in' && p.slot);
    if (!port?.slot) {
      app.toast(t('lgd.t.noTarget'));
      return;
    }
    editLogic(app, setSlot(doc, port.slot, tag));
    app.toast(t('lgd.t.connected', { from: tag, to: `${port.slot.id}.${port.slot.field}` }));
  }

  // ---------- Con trỏ ----------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const view = this.viewEl();
    if (!view) return;
    if (target.closest('.lgd-mini')) {
      this.drag = { mode: 'mini', pid: e.pointerId };
      view.setPointerCapture(e.pointerId);
      this.miniGo(e);
      return;
    }
    const g = this.graph();
    const v = this.view;
    const portEl = target.closest<SVGElement>('[data-outport]');
    if (g && portEl && e.button === 0 && !this.ro) {
      const n = g.byKey.get(portEl.dataset.node!);
      const p = n?.ports.find((x) => x.key === portEl.dataset.outport);
      if (n && p) {
        e.preventDefault();
        const x1 = n.x + p.dx;
        const y1 = n.y + p.dy;
        this.drag = {
          mode: 'wire',
          pid: e.pointerId,
          from: { node: n.key, port: p.key },
          x1,
          y1,
          x2: x1,
          y2: y1,
          type: p.type,
          action: n.kind === 'rule',
        };
        view.setPointerCapture(e.pointerId);
        this.requestUpdate();
        return;
      }
    }
    const wireEl = target.closest<SVGElement>('[data-wire]');
    if (wireEl && e.button === 0) {
      this.selWire = wireEl.dataset.wire!;
      view.focus();
      this.requestUpdate();
      return;
    }
    const nodeEl = target.closest<SVGElement>('[data-node]');
    if (g && nodeEl && e.button === 0) {
      const n = g.byKey.get(nodeEl.dataset.node!);
      if (!n) return;
      this.selectNode(n);
      const owner = n.owner ? g.byKey.get(n.owner) : n;
      if (owner?.movable && !this.ro) {
        this.drag = {
          mode: 'node',
          key: owner.key,
          pid: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          ox: owner.x,
          oy: owner.y,
          dx: 0,
          dy: 0,
          moved: false,
        };
        view.setPointerCapture(e.pointerId);
      }
      return;
    }
    // nền: dời khung nhìn
    this.selWire = null;
    this.drag = {
      mode: 'pan',
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      tx: v.tx,
      ty: v.ty,
      moved: false,
    };
    view.setPointerCapture(e.pointerId);
    view.focus();
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pid !== e.pointerId) return;
    if (d.mode === 'mini') {
      this.miniGo(e);
      return;
    }
    if (d.mode === 'pan') {
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      this.setViewport({ ...this.view, tx: d.tx + dx, ty: d.ty + dy });
      return;
    }
    if (d.mode === 'node') {
      const z = this.view.z;
      const dx = (e.clientX - d.sx) / z;
      const dy = (e.clientY - d.sy) / z;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      const grid = e.altKey ? 1 : LAYOUT_GRID;
      d.dx = snap(d.ox + dx, grid) - d.ox;
      d.dy = snap(d.oy + dy, grid) - d.oy;
      this.requestUpdate();
      return;
    }
    const p = this.toDiagram(e.clientX, e.clientY);
    d.x2 = p.x;
    d.y2 = p.y;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>('[data-pin]');
    this.hoverPort = over ? `${over.dataset.node}|${over.dataset.pin}` : null;
    this.requestUpdate();
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pid !== e.pointerId) return;
    this.drag = null;
    this.hoverPort = null;
    this.viewEl()?.releasePointerCapture(e.pointerId);
    if (d.mode === 'node' && d.moved && (d.dx || d.dy))
      this.moveNodes({ [d.key]: { x: d.ox + d.dx, y: d.oy + d.dy } });
    else if (d.mode === 'wire')
      this.connect(d.from, document.elementFromPoint(e.clientX, e.clientY));
    else if (d.mode === 'pan' && !d.moved) {
      this.selWire = null;
    }
    this.requestUpdate();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.viewEl()!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    const v = this.view;
    this.setViewport({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
  }

  // ---------- Thả từ task card ----------

  private onDragOver(e: DragEvent): void {
    const types = e.dataTransfer?.types ?? [];
    if (this.ro) return;
    if (
      types.includes(LOGIC_BLOCK_MIME) ||
      types.includes(LOGIC_GATE_MIME) ||
      types.includes('text/plain')
    ) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
    }
  }

  private onDrop(e: DragEvent): void {
    const app = this.app;
    const dt = e.dataTransfer;
    if (!dt || this.ro) return;
    e.preventDefault();
    e.stopPropagation();
    const doc = logicDoc(app);
    const g = this.graph();
    const kind = dt.getData(LOGIC_BLOCK_MIME);
    if (isKind(kind)) {
      const p = this.toDiagram(e.clientX, e.clientY);
      dropLogicBlock(app, e, { x: snap(p.x - GEOM.blockW / 2), y: snap(p.y - 16) });
      return;
    }
    const pinEl = (e.target as Element).closest<SVGElement>('[data-pin]');
    const n = pinEl && g ? g.byKey.get(pinEl.dataset.node!) : undefined;
    const port = n?.ports.find((p) => p.key === pinEl?.dataset.pin && p.side === 'in');
    const gate = dt.getData(LOGIC_GATE_MIME) as GateTool | '';
    if (gate) {
      if (!doc || !port?.slot) {
        app.toast(t('lgd.t.gateHint', { gate: t(`lgd.gate.${gate}` as MessageKey) }));
        return;
      }
      editLogic(app, wrapSlot(doc, port.slot, gate));
      return;
    }
    const tag = dt.getData('text/plain').trim();
    if (!doc || !port?.slot || !tag) {
      app.toast(t('lgd.t.tagHint'));
      return;
    }
    editLogic(app, setSlot(doc, port.slot, tag));
    app.toast(t('lgd.t.connected', { from: tag, to: `${port.slot.id}.${port.slot.field}` }));
  }

  // ---------- Bàn phím ----------

  private focusNode(key: string | null): void {
    if (!key) return;
    void this.updateComplete.then(() =>
      this.querySelector<SVGGElement>(`[data-node="${CSS.escape(key)}"][tabindex]`)?.focus(),
    );
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as Element;
    const nodeEl = target.closest<SVGElement>('[data-node]');
    const g = this.graph();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (e.key === '0' && !mod) {
      e.preventDefault();
      this.fit();
      return;
    }
    // phím trên một khối: thao tác trên chính khối đó (chọn nó trước nếu chưa chọn)
    const focused = nodeEl && g ? g.byKey.get(nodeEl.dataset.node!) : undefined;
    if (focused && this.selKey() !== focused.key && focused.movable) this.selectNode(focused);
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      this.deleteSelection();
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      this.duplicate();
      return;
    }
    if (!nodeEl || !g) return;
    const n = g.byKey.get(nodeEl.dataset.node!);
    if (!n) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.selectNode(n, n.type === 'block' ? 'id' : undefined);
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const a = arrows[e.key];
    if (a && n.movable && !this.ro) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? LAYOUT_GRID * 4 : LAYOUT_GRID;
      this.moveNodes(
        { [n.key]: { x: n.x + a[0] * step, y: n.y + a[1] * step } },
        `lgd-move:${n.key}`,
      );
      this.focusNode(n.key);
    }
  }

  // ---------- Giá trị sống ----------

  private liveMode(): 'test' | 'online' | null {
    const app = this.app;
    const ui = logicUi(app);
    if (ui.dockTab === 'test') {
      const sim = ui.sim;
      if (sim && ui.simDoc === logicDoc(app) && !sim.error && sim.scans > 0) return 'test';
    }
    return liveOnline(app) ? 'online' : null;
  }

  private liveValue(mode: 'test' | 'online' | null, tag: string): LiveVal | null {
    if (!mode) return null;
    if (mode === 'test') {
      const v = logicUi(this.app).sim?.value(tag);
      return v ? { value: v.value, quality: v.quality } : null;
    }
    const v = this.app.readValue(tag);
    if (v) return { value: v.value as LiveVal['value'], quality: v.quality };
    for (const b of logicUi(this.app).live?.blocks.values() ?? [])
      if (b.outputs && tag in b.outputs)
        return { value: b.outputs[tag] as LiveVal['value'], quality: 'GOOD' };
    return null;
  }

  private blockLive(mode: 'test' | 'online' | null, id: string): BlockLive | null {
    if (mode === 'test') {
      const sim = logicUi(this.app).sim;
      if (!sim?.hasBlock(id)) return null;
      const s = sim.state(id);
      return {
        state: s.state,
        reason: s.reason ?? null,
        ...(s.edgeId !== undefined ? { fired: s.edgeId } : {}),
      };
    }
    if (mode === 'online') {
      const s = logicUi(this.app).live?.blocks.get(id);
      if (!s) return null;
      return {
        state: s.state,
        reason: s.reason,
        ...(s.fired !== undefined
          ? { fired: s.fired, firedText: t('lgd.fired', { n: s.fired }) }
          : {}),
      };
    }
    return null;
  }

  /** Giá trị của cổng suy ra: tính lại đoạn biểu thức trên giá trị hiện có (chỉ để vẽ). */
  private gateValue(mode: 'test' | 'online' | null, n: GNode): LiveVal | null {
    if (!mode || !n.text) return null;
    const doc = logicDoc(this.app);
    if (this.progsKey !== doc) {
      this.progs.clear();
      this.progsKey = doc;
    }
    const key = `${n.gate}|${n.text}`;
    let p = this.progs.get(key);
    if (p === undefined) {
      const types = new Map<string, TagDataType>(projectTags(this.app).map((x) => [x.id, x.type]));
      for (const o of outputTagsOf(doc)) if (!types.has(o.tag)) types.set(o.tag, o.type);
      const tables = new Set(tableNames(this.app));
      const env = {
        tagType: (id: string) => types.get(id),
        hasTable: (x: string) => tables.has(x),
      };
      const targets: TagDataType[] = n.gate === 'expr' ? ['FLOAT64', 'BOOL', 'STRING'] : ['BOOL'];
      p = null;
      for (const target of targets) {
        const r = compile(n.text, { ...env, target });
        if (r.ok) {
          p = r.program;
          break;
        }
      }
      this.progs.set(key, p);
    }
    if (!p) return null;
    const vals: InputValue[] = p.inputs.map((id) => {
      const v = this.liveValue(mode, id);
      if (!v || v.value === null) return { value: null, quality: 'BAD' };
      const value = typeof v.value === 'bigint' ? Number(v.value) : v.value;
      return {
        value,
        quality: v.quality === 'GOOD' ? 'GOOD' : v.quality === 'UNCERTAIN' ? 'UNCERTAIN' : 'BAD',
      };
    });
    try {
      const r = evaluate(p, (i) => vals[i]!, new Map());
      return r.quality === 'BAD' || r.value === undefined
        ? { value: null, quality: 'BAD' }
        : { value: r.value, quality: r.quality };
    } catch {
      return null;
    }
  }

  /** Dây vào cổng vào đọc Tag nào (để khai báo Online). */
  private declareLive(g: LogicGraph): void {
    const app = this.app;
    if (!liveOnline(app)) {
      if (this.declared) app.live.release('logic-diagram');
      this.declared = '';
      return;
    }
    const tags = new Set<string>();
    for (const n of g.nodes) {
      if (n.type === 'tag' && n.id) tags.add(n.id);
      for (const p of n.ports) if (p.tag) tags.add(p.tag);
    }
    for (const w of blocksOf(logicDoc(app), 'writes'))
      if (typeof w.tag === 'string') tags.add(w.tag);
    const list = [...tags].sort();
    const key = list.join('|');
    if (key === this.declared) return;
    this.declared = key;
    app.live.declare('logic-diagram', list, PRIORITY.watch);
  }

  // ---------- Vẽ ----------

  protected override updated(): void {
    const el = this.viewEl();
    if (el && !this.resizeObs && typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w !== this.size.w || h !== this.size.h) {
          const first = this.size.w === 0;
          this.size = { w, h };
          if (first && !logicUi(this.app).dview) this.fit();
          else this.requestUpdate();
        }
      });
      this.resizeObs.observe(el);
    }
    const ui = logicUi(this.app);
    if (el && !ui.dview && el.clientWidth > 0) this.fit();
    // khối được chọn từ nơi khác (danh sách lỗi, cây, bảng): đưa vào vùng nhìn
    const key = this.selKey();
    if (key !== this.lastSel) {
      this.lastSel = key;
      const n = key ? this.graph()?.byKey.get(key) : undefined;
      if (n && !this.drag) this.reveal(n);
    }
  }

  private pos(n: GNode): { x: number; y: number } {
    const d = this.drag;
    if (d?.mode === 'node' && (n.key === d.key || n.owner === d.key))
      return { x: n.x + d.dx, y: n.y + d.dy };
    return { x: n.x, y: n.y };
  }

  private portXY(g: LogicGraph, end: { node: string; port: string }): [number, number] | null {
    const n = g.byKey.get(end.node);
    const p = n?.ports.find((x) => x.key === end.port);
    if (!n || !p) return null;
    const o = this.pos(n);
    return [o.x + p.dx, o.y + p.dy];
  }

  private wirePath(x1: number, y1: number, x2: number, y2: number): string {
    const dx =
      x2 >= x1 + 24 ? Math.max(30, (x2 - x1) / 2) : 60 + Math.min(160, Math.abs(y2 - y1) / 3);
    return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  }

  /**
   * Dây hành động (luật → Ghi PLC / Tag đích): đường gấp khúc đi dọc trong khe ngay trước nút đích (khe giữa cột luật và cột
   * Ghi PLC trống), góc bo 6 px; ngược chiều thì như dây thường.
   */
  private stepPath(x1: number, y1: number, x2: number, y2: number): string {
    if (x2 < x1 + 40) return this.wirePath(x1, y1, x2, y2);
    const xm = x2 - 22;
    const dy = y2 - y1;
    if (Math.abs(dy) < 1) return `M${x1} ${y1}H${x2}`;
    const r = Math.min(6, Math.abs(dy) / 2);
    const s = dy > 0 ? 1 : -1;
    return `M${x1} ${y1}H${xm - r}Q${xm} ${y1} ${xm} ${y1 + s * r}V${y2 - s * r}Q${xm} ${y2} ${xm + r} ${y2}H${x2}`;
  }

  private renderWire(g: LogicGraph, w: Wire, mode: 'test' | 'online' | null, sel: string | null) {
    const a = this.portXY(g, w.from);
    const b = this.portXY(g, w.to);
    if (!a || !b) return nothing;
    const from = g.byKey.get(w.from.node)!;
    let v: LiveVal | null = null;
    if (w.kind === 'data')
      v = w.tag
        ? this.liveValue(mode, w.tag)
        : from.type === 'gate'
          ? this.gateValue(mode, from)
          : null;
    const on = isTrue(v);
    const d =
      w.kind === 'action'
        ? this.stepPath(a[0], a[1], b[0], b[1])
        : this.wirePath(a[0], a[1], b[0], b[1]);
    const cls = [
      'wr',
      w.kind === 'action' ? 'act' : `ty-${w.type}`,
      on ? 'on' : '',
      v && v.quality !== 'GOOD' ? 'bad' : '',
      w.mark === 'e' ? 'err' : w.mark === 'w' ? 'warn' : '',
      this.selWire === w.key ? 'sel' : '',
      sel && (w.from.node === sel || w.to.node === sel) ? 'hl' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return svg`<g class=${cls} data-wire=${w.key}>
      <path class="wr-hit" d=${d}></path>
      ${w.kind === 'action' ? svg`<path class="wr-halo" d=${d}></path>` : nothing}
      <path class="wr-line" d=${d}></path>
    </g>`;
  }

  private portEl(n: GNode, p: GPort, mode: 'test' | 'online' | null): SVGTemplateResult {
    const cls = [
      'pt',
      p.side,
      `ty-${p.type}`,
      p.mark === 'e' ? 'err' : p.mark === 'w' ? 'warn' : '',
      this.hoverPort === `${n.key}|${p.key}` ? 'hover' : '',
      p.optional ? 'opt' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const r = n.type === 'gate' ? 3.5 : 4.5;
    const wd = this.drag?.mode === 'wire' ? this.drag : null;
    const dragType = wd && !wd.action ? wd.type : null;
    const dim =
      dragType && p.side === 'in' && p.type !== 'any' && dragType !== 'any' && p.type !== dragType;
    if (p.side === 'out') {
      const v = p.tag ? this.liveValue(mode, p.tag) : null;
      const showNum = v && v.value !== null && typeof v.value !== 'boolean';
      return svg`<g class=${cls} data-outport=${p.key} data-node=${n.key}>
        <circle class="pt-hit" cx=${p.dx} cy=${p.dy} r="10"></circle>
        <circle class="pt-dot ${isTrue(v) ? 'on' : ''}" cx=${p.dx} cy=${p.dy} r=${r}></circle>
        ${p.label && n.type === 'block' ? svg`<text class="pt-lab" x=${p.dx - 9} y=${p.dy + 4} text-anchor="end">${p.label}</text>` : nothing}
        ${showNum ? svg`<text class="pv" x=${p.dx + 9} y=${p.dy - 6}>${fmtVal(v)}</text>` : nothing}
      </g>`;
    }
    const text = p.text;
    return svg`<g class="${cls} ${dim ? 'dim' : ''}" data-pin=${p.key} data-node=${n.key}>
      <circle class="pt-hit" cx=${p.dx} cy=${p.dy} r="10"></circle>
      <circle class="pt-dot" cx=${p.dx} cy=${p.dy} r=${r}></circle>
      ${p.label && n.type === 'block' ? svg`<text class="pt-lab" x=${p.dx + 9} y=${p.dy + 4}>${p.label}</text>` : nothing}
      ${p.label && n.type === 'gate' ? svg`<text class="pt-lab sm" x=${p.dx + 7} y=${p.dy + 3.5}>${p.label}</text>` : nothing}
      ${
        text !== undefined
          ? svg`<text class="pt-text ${p.broken ? 'broken' : ''} ${text === '' && !p.optional ? 'unset' : ''}" x=${p.dx - 8} y=${p.dy + 4} text-anchor="end">${
              text === '' ? t('lgd.unset') : text.length > 28 ? `${text.slice(0, 27)}…` : text
            }</text>`
          : nothing
      }
    </g>`;
  }

  private detail(n: GNode, b: Block): string {
    switch (n.kind) {
      case 'rule': {
        const parts = [t('lgd.d.hold', { s: fmtSeconds(Number(b.hold ?? 0)) })];
        if (typeof b.repeatMs === 'number')
          parts.push(t('lgd.d.repeat', { s: fmtSeconds(b.repeatMs) }));
        if (b.enabled === false) parts.push(t('lgd.d.off'));
        return parts.join(' · ');
      }
      case 'timer':
        return t('lgd.d.pt', { s: fmtSeconds(Number(b.pt ?? 0)) });
      case 'counter':
        return typeof b.preset === 'number'
          ? t('lgd.d.preset', { n: b.preset })
          : t('lgd.d.noPreset');
      case 'totalizer':
        return t('lgd.d.rate', { u: String(b.rateUnit ?? ''), f: num(Number(b.factor ?? 1)) });
      case 'runhours':
        return typeof b.serviceEveryHours === 'number'
          ? t('lgd.d.service', { h: num(b.serviceEveryHours) })
          : t('lgd.d.noService');
      case 'schedule': {
        const w = Array.isArray(b.weekly)
          ? (b.weekly as Array<{ from?: string; to?: string }>)
          : [];
        return w.length === 1
          ? `${w[0]!.from ?? ''}–${w[0]!.to ?? ''}`
          : t('lgd.d.windows', { n: w.length });
      }
      case 'writes':
        return t('lgd.d.write', { tag: String(b.tag ?? '?') });
      default:
        return '';
    }
  }

  private blockTitle(n: GNode, b: Block): string {
    if (n.kind === 'timer') return String(b.kind ?? 'ton').toUpperCase();
    return kindLabel(n.kind!);
  }

  private ariaOf(n: GNode, sel: boolean, b: Block | null): string {
    const parts: string[] = [];
    if (n.type === 'block')
      parts.push(t('lgd.node.block', { kind: kindLabel(n.kind!), id: n.id! }));
    else if (n.type === 'tag') parts.push(t('lgd.node.tag', { id: n.id! }));
    else parts.push(t('lgd.node.out', { id: n.id! }));
    if (b) {
      const d = this.detail(n, b);
      if (d) parts.push(d);
      const ins = n.ports
        .filter((p) => p.side === 'in' && p.slot)
        .map((p) => `${p.key} = ${String(b[p.key] ?? '') || t('lgd.unset')}`);
      if (ins.length) parts.push(t('lgd.node.ins', { list: ins.join('; ') }));
      const outs = n.ports.filter((p) => p.side === 'out' && p.tag).map((p) => p.tag!);
      if (outs.length) parts.push(t('lgd.node.outs', { list: outs.join(', ') }));
    }
    if (n.missing) parts.push(t('lgd.node.missing'));
    if (n.mark === 'e') parts.push(t('lgd.node.err'));
    else if (n.mark === 'w') parts.push(t('lgd.node.warn'));
    if (sel) parts.push(t('lgd.node.sel'));
    return parts.join(', ');
  }

  private renderBlock(n: GNode, mode: 'test' | 'online' | null, sel: boolean, now: number) {
    const doc = logicDoc(this.app);
    const b = findBlock(doc, n.kind!, n.id!) ?? ({ id: n.id! } as Block);
    const o = this.pos(n);
    const live = this.blockLive(mode, n.id!);
    if (live?.fired !== undefined) {
      const prev = this.fired.get(n.key);
      if (!prev) this.fired.set(n.key, { n: live.fired, at: 0 });
      else if (prev.n !== live.fired) {
        this.fired.set(n.key, { n: live.fired, at: now });
        this.armFire();
      }
    }
    const firing = live && now - (this.fired.get(n.key)?.at ?? 0) < FIRE_MS;
    const disabled = n.kind === 'rule' && b.enabled === false;
    let extra = '';
    if (n.kind === 'timer' && mode) {
      const et = n.ports.find((p) => p.key === 'et')?.tag;
      const v = et ? this.liveValue(mode, et) : null;
      const ms = v && v.value !== null ? Number(v.value) : NaN;
      const pt = Number(b.pt ?? 0);
      if (Number.isFinite(ms) && ms > 0 && ms < pt)
        extra = t('lgd.remain', { s: fmtSeconds(pt - ms) });
    }
    if (n.kind === 'writes' && mode && typeof b.tag === 'string') {
      const v = this.liveValue(mode, b.tag);
      if (v) extra = `= ${fmtVal(v)}`;
    }
    const cls = [
      'nd',
      'blk',
      `k-${n.kind}`,
      sel ? 'sel' : '',
      n.mark === 'e' ? 'err' : n.mark === 'w' ? 'warn' : '',
      firing ? 'fire' : '',
      disabled ? 'off' : '',
      live ? `st-${live.state}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const W = n.w;
    const H = n.h;
    const detail = this.detail(n, b);
    return svg`<g class=${cls} transform="translate(${o.x} ${o.y})" data-node=${n.key} data-kind=${n.kind!}
        tabindex="0" role="button" aria-label=${this.ariaOf(n, sel, b)}
        @focus=${() => {
          if (this.selKey() !== n.key) this.selectNode(n);
        }}>
      <rect class="nd-bg" width=${W} height=${H} rx="6"></rect>
      <path class="nd-head" d=${`M0 6a6 6 0 0 1 6 -6h${W - 12}a6 6 0 0 1 6 6v${GEOM.head - 6}h${-W}z`}></path>
      <use class="nd-ic" href=${iconHref(KIND_ICON[n.kind!])} x="8" y="7" width="16" height="16"></use>
      <text class="nd-kind" x="30" y="19">${this.blockTitle(n, b)}</text>
      <text class="nd-id" x=${W - 8} y="19" text-anchor="end">${n.id!.length > 18 ? `${n.id!.slice(0, 17)}…` : n.id}</text>
      <line class="nd-sep" x1="0" y1=${H - GEOM.foot} x2=${W} y2=${H - GEOM.foot}></line>
      <text class="nd-detail" x="8" y=${H - 8}>${detail.length > 30 ? `${detail.slice(0, 29)}…` : detail}</text>
      ${
        live
          ? svg`<g class="nd-live"><rect class="chip-bg" x=${W - 8 - this.chipW(live, extra)} y=${H - GEOM.foot + 4} width=${this.chipW(live, extra)} height="16" rx="8"></rect>
              <text class="chip-tx" x=${W - 8 - this.chipW(live, extra) / 2} y=${H - 8} text-anchor="middle">${this.chipText(live, extra)}</text></g>`
          : extra
            ? svg`<text class="nd-extra" x=${W - 8} y=${H - 8} text-anchor="end">${extra}</text>`
            : nothing
      }
      ${n.ports.map((p) => this.portEl(n, p, mode))}
    </g>`;
  }

  private chipText(l: BlockLive, extra: string): string {
    return [extra || l.firedText || '', l.state].filter(Boolean).join(' · ');
  }

  private chipW(l: BlockLive, extra: string): number {
    return Math.min(GEOM.blockW - 90, 14 + this.chipText(l, extra).length * 6.2);
  }

  private armFire(): void {
    if (this.fireTimer) return;
    this.fireTimer = setTimeout(() => {
      this.fireTimer = null;
      this.requestUpdate();
    }, FIRE_MS + 50);
  }

  private renderTag(n: GNode, mode: 'test' | 'online' | null, sel: boolean) {
    const o = this.pos(n);
    const v = n.type === 'tag' || n.type === 'out' ? this.liveValue(mode, n.id!) : null;
    const cls = [
      'nd',
      n.type === 'tag' ? 'tagn' : 'outn',
      sel ? 'sel' : '',
      n.missing ? 'missing' : '',
      isTrue(v) ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const id = n.id!.length > 22 ? `${n.id!.slice(0, 21)}…` : n.id!;
    return svg`<g class=${cls} transform="translate(${o.x} ${o.y})" data-node=${n.key} tabindex="0" role="button"
        aria-label=${this.ariaOf(n, sel, null)}
        @focus=${() => {
          if (this.selKey() !== n.key) this.selectNode(n);
        }}>
      <rect class="nd-bg" width=${n.w} height=${n.h} rx=${n.type === 'tag' ? 16 : 4}></rect>
      <use class="nd-ic" href=${iconHref(n.type === 'tag' ? 'tag' : 'set-tag')} x=${n.type === 'tag' ? 10 : 14} y="8" width="16" height="16"></use>
      <text class="nd-tag" x=${n.type === 'tag' ? 30 : 34} y="20">${id}</text>
      ${
        v && mode
          ? svg`<text class="nd-val" x=${n.w - 14} y="20" text-anchor="end">${fmtVal(v)}</text>`
          : n.tagType
            ? svg`<text class="nd-type" x=${n.w - 14} y="20" text-anchor="end">${n.tagType}</text>`
            : nothing
      }
      ${n.ports.map((p) => this.portEl(n, p, mode))}
    </g>`;
  }

  /** Toán hạng Tag gắn vào chân (FBD): hộp tên Tag, đi theo khối, nhấp chọn khối và ô. */
  private renderOperand(n: GNode, mode: 'test' | 'online' | null, selOwner: boolean) {
    const o = this.pos(n);
    const v = this.liveValue(mode, n.id!);
    const cls = [
      'nd',
      'opn',
      selOwner ? 'own' : '',
      n.missing ? 'missing' : '',
      n.mark === 'e' ? 'err' : n.mark === 'w' ? 'warn' : '',
      isTrue(v) ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return svg`<g class=${cls} transform="translate(${o.x} ${o.y})" data-node=${n.key} data-tag=${n.id!}>
      <title>${n.tagType ? `${n.id} (${n.tagType})` : n.id}</title>
      <rect class="nd-bg" width=${n.w} height=${n.h} rx=${n.h / 2}></rect>
      <use class="nd-ic" href=${iconHref('tag')} x="7" y="5" width="12" height="12"></use>
      <text class="nd-tag" x="22" y="15">${n.id}</text>
      ${n.ports.map((p) => this.portEl(n, p, mode))}
    </g>`;
  }

  private renderGate(n: GNode, mode: 'test' | 'online' | null, selOwner: boolean) {
    const o = this.pos(n);
    const v = this.gateValue(mode, n);
    const cls = [
      'nd',
      'gate',
      `g-${n.gate}`,
      selOwner ? 'own' : '',
      n.mark === 'e' ? 'err' : n.mark === 'w' ? 'warn' : '',
      isTrue(v) ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const title =
      n.gate === 'expr' ? (n.text!.length > 26 ? `${n.text!.slice(0, 25)}…` : n.text!) : n.title!;
    return svg`<g class=${cls} transform="translate(${o.x} ${o.y})" data-node=${n.key}>
      <title>${n.text}</title>
      <rect class="nd-bg" width=${n.w} height=${n.h} rx="4"></rect>
      <text class="gt-title" x=${n.gate === 'expr' ? 8 : n.w / 2} y="13" text-anchor=${n.gate === 'expr' ? 'start' : 'middle'}>${title}</text>
      ${v && v.value !== null && typeof v.value !== 'boolean' ? svg`<text class="pv" x=${n.w + 9} y=${n.h / 2 - 6}>${fmtVal(v)}</text>` : nothing}
      ${n.ports.map((p) => this.portEl(n, p, mode))}
    </g>`;
  }

  private miniGo(e: PointerEvent): void {
    const g = this.graph();
    const mini = this.querySelector<SVGSVGElement>('.lgd-mini svg');
    const el = this.viewEl();
    if (!g || !mini || !el) return;
    const r = mini.getBoundingClientRect();
    const { s, ox, oy } = this.miniScale(g);
    const x = (e.clientX - r.left - ox) / s;
    const y = (e.clientY - r.top - oy) / s;
    const v = this.view;
    this.setViewport({ ...v, tx: el.clientWidth / 2 - x * v.z, ty: el.clientHeight / 2 - y * v.z });
  }

  private miniScale(g: LogicGraph): { s: number; ox: number; oy: number } {
    const b = g.bounds;
    const s = Math.min((MINI_W - 12) / Math.max(1, b.w), (MINI_H - 12) / Math.max(1, b.h));
    return { s, ox: (MINI_W - b.w * s) / 2 - b.x * s, oy: (MINI_H - b.h * s) / 2 - b.y * s };
  }

  private renderMini(g: LogicGraph, sel: string | null): TemplateResult {
    const el = this.viewEl();
    const v = this.view;
    const { s, ox, oy } = this.miniScale(g);
    const vw = (el?.clientWidth ?? 0) / v.z;
    const vh = (el?.clientHeight ?? 0) / v.z;
    const vx = -v.tx / v.z;
    const vy = -v.ty / v.z;
    return html`<div class="lgd-mini" aria-hidden="true" title=${t('lgd.minimap')}>
      <svg width=${MINI_W} height=${MINI_H}>
        <g transform="translate(${ox} ${oy}) scale(${s})">
          ${g.nodes.map(
            (n) =>
              svg`<rect class="mn ${n.type === 'block' ? `k-${n.kind}` : n.type} ${n.key === sel ? 'sel' : ''} ${n.mark === 'e' ? 'err' : ''}" x=${n.x} y=${n.y} width=${n.w} height=${n.h}></rect>`,
          )}
          <rect
            class="mn-view"
            x=${vx}
            y=${vy}
            width=${vw}
            height=${vh}
            stroke-width=${1.5 / s}
          ></rect>
        </g>
      </svg>
    </div>`;
  }

  private liveChip(mode: 'test' | 'online' | null) {
    if (mode === 'test') {
      const sim = logicSim(this.app);
      return html`<span class="chip sim lgd-live" data-role="live" title=${t('lgd.live.tip')}
        >${icon('play', 'sm')}${t('lgd.live.test', { t: num((sim?.t ?? 0) / 1000) })}</span
      >`;
    }
    if (mode === 'online')
      return html`<span class="chip ok lgd-live" data-role="live" title=${t('lgd.live.tip')}
        >${icon('online', 'sm')}${t('lgd.live.online')}</span
      >`;
    return nothing;
  }

  protected override render() {
    const g = this.graph();
    if (!g) return nothing;
    this.declareLive(g);
    const mode = this.liveMode();
    const v = this.view;
    const sel = this.selKey();
    const selOwner = sel && g.byKey.get(sel)?.type === 'block' ? sel : null;
    const now = performance.now();
    const ro = this.ro;
    const d = this.drag;
    const blocks = g.nodes.filter((n) => n.type === 'block');
    const tags = g.nodes.filter((n) => n.type === 'out');
    const gates = g.nodes.filter((n) => n.type === 'gate');
    const ops = g.nodes.filter((n) => n.type === 'tag');
    const gridS = LAYOUT_GRID * v.z;
    return html`<div class="lgd-tools" role="toolbar" aria-label=${t('lgd.toolbar')}>
        <button
          type="button"
          class="ibtn"
          data-act="zoom-out"
          aria-label=${t('lgd.zoomOut')}
          title=${t('lgd.zoomOut')}
          @click=${() => this.zoomBy(1 / 1.2)}
        >
          ${icon('zoomout')}
        </button>
        <span
          class="lgd-z mono sm-text"
          data-role="zoom"
          role="status"
          aria-label=${t('lgd.zoom', { z: Math.round(v.z * 100) })}
          >${Math.round(v.z * 100)} %</span
        >
        <button
          type="button"
          class="ibtn"
          data-act="zoom-in"
          aria-label=${t('lgd.zoomIn')}
          title=${t('lgd.zoomIn')}
          @click=${() => this.zoomBy(1.2)}
        >
          ${icon('zoomin')}
        </button>
        <button
          type="button"
          class="tbtn"
          data-act="fit"
          title=${t('lgd.fit')}
          @click=${() => this.fit()}
        >
          ${icon('fit')}${t('lgd.fit').replace(/ \(0\)$/, '')}
        </button>
        <button
          type="button"
          class="tbtn"
          data-act="zoom-100"
          title=${t('lgd.actual')}
          @click=${() => {
            const el = this.viewEl();
            this.zoomBy(1 / v.z, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2);
          }}
        >
          100 %
        </button>
        <span class="tsep"></span>
        <button
          type="button"
          class="tbtn"
          data-act="arrange"
          title=${t('lgd.arrangeTip')}
          ?disabled=${ro}
          @click=${() => this.arrange()}
        >
          ${icon('grid')}${t('lgd.arrange')}
        </button>
        <span class="grow"></span>
        ${this.liveChip(mode)}
        <span class="muted sm-text lgd-keys">${t('lgd.keys')}</span>
      </div>
      <div
        class="lgd-view ${d?.mode === 'pan' ? 'panning' : ''} ${d?.mode === 'wire' ? 'wiring' : ''}"
        tabindex="0"
        role="application"
        aria-label=${t('lgd.label')}
        aria-describedby="lgd-desc"
        @pointerdown=${(e: PointerEvent) => this.onPointerDown(e)}
        @pointermove=${(e: PointerEvent) => this.onPointerMove(e)}
        @pointerup=${(e: PointerEvent) => this.onPointerUp(e)}
        @pointercancel=${(e: PointerEvent) => this.onPointerUp(e)}
        @wheel=${(e: WheelEvent) => this.onWheel(e)}
        @keydown=${(e: KeyboardEvent) => this.onKey(e)}
        @dragover=${(e: DragEvent) => this.onDragOver(e)}
        @drop=${(e: DragEvent) => this.onDrop(e)}
      >
        <p id="lgd-desc" class="visually-hidden">${t('lgd.desc')}</p>
        <svg class="lgd-svg" aria-hidden=${blocks.length + tags.length === 0 ? 'true' : 'false'}>
          <defs>
            <pattern
              id="lgd-grid"
              width=${gridS}
              height=${gridS}
              patternUnits="userSpaceOnUse"
              x=${v.tx % gridS}
              y=${v.ty % gridS}
            >
              <circle cx="0.75" cy="0.75" r="0.75" class="lgd-dot"></circle>
            </pattern>
          </defs>
          <rect class="lgd-bg" width="100%" height="100%" fill="url(#lgd-grid)"></rect>
          <g transform="translate(${v.tx} ${v.ty}) scale(${v.z})">
            <g class="wires">
              ${g.wires.filter((w) => w.kind === 'data').map((w) => this.renderWire(g, w, mode, sel))}
            </g>
            <g class="gates">
              ${gates.map((n) => this.renderGate(n, mode, n.owner === selOwner))}
              ${ops.map((n) => this.renderOperand(n, mode, n.owner === selOwner))}
            </g>
            <g class="nodes">
              ${blocks.map((n) => this.renderBlock(n, mode, n.key === sel, now))}
              ${tags.map((n) => this.renderTag(n, mode, n.key === sel))}
            </g>
            <g class="acts">
              ${g.wires.filter((w) => w.kind === 'action').map((w) => this.renderWire(g, w, mode, sel))}
            </g>
            ${
              d?.mode === 'wire'
                ? svg`<path class="wr-drag ${d.action ? 'act' : ''}" d=${this.wirePath(d.x1, d.y1, d.x2, d.y2)}></path>`
                : nothing
            }
          </g>
        </svg>
        ${
          blocks.length === 0
            ? html`<div class="lgd-empty help">
                ${icon('logic', 'lg')}
                <p>${t('lgd.empty')}</p>
              </div>`
            : this.renderMini(g, sel)
        }
      </div>`;
  }
}

customElements.define('mat-logic-diagram', LogicDiagram);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-diagram': LogicDiagram;
  }
}
