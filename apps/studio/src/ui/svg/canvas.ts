// Canvas của trình vẽ SVG (feature 011, T162, T164; FR-097, FR-101, FR-114; contracts/svg-editor.md §11): DOM thật của tài
// liệu trong Shadow DOM của phần tử (id, `url(#…)`, `<style>` của tệp không đụng tới trang Studio), dựng bằng
// `createElementNS`/`setAttribute` từ `DrawDoc` đã qua allowlist (không innerHTML, không phân tích lại chuỗi); lớp phủ
// riêng cho vùng chọn, tay nắm, đường gióng, khung chọn, hình đang vẽ. Sau mỗi lô chỉ vẽ lại các nút trong `targets()`.
// Kéo không đổi tài liệu: xem trước bằng `transform` trên DOM (≥ 200 nút: chỉ hộp bao) tới khi thả.
import {
  invert,
  multiply,
  parentCtm,
  serializeTransform,
  transformOf,
  type Box,
  type DrawDoc,
  type Matrix,
  type NodeId,
} from '@mat/svg-edit';
import { isLayer } from '@mat/svg-edit';
import type { SvgEditor } from '../../model/svg/editor.ts';
import type { SvgSession } from '../../model/svg/session.ts';
import type { GuideLine } from '../../model/svg-state.ts';
import { drawOverlay, type ViewMap } from './handles.ts';
import { drawGuides } from './guides.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Thuộc tính của gốc tài liệu mà canvas tự đặt (hiển thị theo zoom), không chép từ tệp. */
const ROOT_OWN = new Set(['width', 'height', 'x', 'y', 'viewBox', 'preserveAspectRatio']);

const SHADOW_CSS = `
:host { position: relative; display: block; overflow: hidden; outline: none; }
.paper { position: absolute; box-shadow: 0 0 0 1px var(--border-2, #b3bec3); background-color: #fff;
  background-image: linear-gradient(45deg, #eef1f2 25%, transparent 25%), linear-gradient(-45deg, #eef1f2 25%, transparent 25%),
  linear-gradient(45deg, transparent 75%, #eef1f2 75%), linear-gradient(-45deg, transparent 75%, #eef1f2 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
.grid { position: absolute; pointer-events: none; }
svg.doc { position: absolute; overflow: visible; }
svg.ov { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
svg.ov .hit { pointer-events: all; }
`;

/** Vạch lưới quá dày (bước trên màn hình nhỏ hơn) thì ẩn. */
const MIN_GRID_PX = 5;

export interface CanvasHost {
  editor(): SvgEditor | null;
  /** Lưới và đường gióng cố định của tệp. */
  showGrid(): boolean;
  guides(): readonly GuideLine[];
  /** Lớp ẩn/khóa (svg-state.json). */
  layerHidden(name: string): boolean;
  layerLocked(name: string): boolean;
}

export class MatSvgCanvas extends HTMLElement {
  private readonly shadow: ShadowRoot;
  private readonly paper: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly overlay: SVGSVGElement;
  private docEl: SVGSVGElement | null = null;
  private dom = new Map<NodeId, Node>();
  private nid = new WeakMap<Node, NodeId>();
  private session: SvgSession | null = null;
  private renderedDoc: DrawDoc | null = null;
  /** Nút đang có `transform` xem trước (khôi phục khi thả hoặc hủy). */
  private previewed = new Set<NodeId>();
  host: CanvasHost | null = null;
  zoom = 1;
  panX = 24;
  panY = 24;
  /** Số nút DOM của lần dựng gần nhất (đo hiệu năng). */
  built = 0;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    this.paper = document.createElement('div');
    this.paper.className = 'paper';
    this.grid = document.createElement('div');
    this.grid.className = 'grid';
    this.overlay = document.createElementNS(SVG_NS, 'svg');
    this.overlay.setAttribute('class', 'ov');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.shadow.append(style, this.paper, this.grid, this.overlay);
  }

  /** Gắn phiên (mở tệp, chuyển tab, nạp lại): dựng lại cả tài liệu. */
  attach(session: SvgSession | null): void {
    if (session === this.session && session?.doc === this.renderedDoc) return;
    this.session = session;
    this.rebuild();
  }

  get doc(): DrawDoc | null {
    return this.session?.doc ?? null;
  }

  // ---------- dựng DOM của tài liệu ----------

  rebuild(): void {
    const doc = this.doc;
    this.dom = new Map();
    this.nid = new WeakMap();
    this.previewed.clear();
    this.docEl?.remove();
    this.docEl = null;
    this.renderedDoc = doc;
    this.built = 0;
    if (!doc) return;
    const root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute('class', 'doc');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('preserveAspectRatio', 'none');
    this.syncAttrs(root, doc.root);
    this.dom.set(doc.root, root);
    this.nid.set(root, doc.root);
    for (const c of doc.nodes.get(doc.root)!.children) {
      const k = this.build(c);
      if (k) root.appendChild(k);
    }
    this.docEl = root;
    this.shadow.insertBefore(root, this.overlay);
    this.applyLayers();
    this.layout();
  }

  private build(id: NodeId): Node | null {
    const doc = this.doc!;
    const n = doc.nodes.get(id);
    if (!n) return null;
    if (n.tag === '#comment') return null;
    if (n.tag === '#text') {
      const t = document.createTextNode(n.text ?? '');
      this.dom.set(id, t);
      this.nid.set(t, id);
      this.built++;
      return t;
    }
    const el = document.createElementNS(SVG_NS, n.tag);
    this.syncAttrs(el, id);
    for (const c of n.children) {
      const k = this.build(c);
      if (k) el.appendChild(k);
    }
    this.dom.set(id, el);
    this.nid.set(el, id);
    this.built++;
    return el;
  }

  /** Chép thuộc tính của nút sang phần tử DOM (thêm, đổi, bỏ). */
  private syncAttrs(el: Element, id: NodeId): void {
    const doc = this.doc!;
    const n = doc.nodes.get(id)!;
    const isRoot = id === doc.root;
    const want = new Map<string, string>();
    for (const [k, v] of n.attrs) {
      if (isRoot && ROOT_OWN.has(k)) continue;
      if (k.startsWith('xmlns')) continue;
      // phòng thủ thêm (đã qua allowlist khi đọc): không sự kiện, không liên kết ra ngoài
      if (/^on/i.test(k)) continue;
      if (
        (k === 'href' || k === 'xlink:href') &&
        !(v.startsWith('#') || v.startsWith('data:image/'))
      )
        continue;
      want.set(k, v);
    }
    for (const a of [...el.attributes]) {
      const name = a.name;
      if (isRoot && (ROOT_OWN.has(name) || name === 'class' || name === 'aria-hidden')) continue;
      if (!want.has(name)) el.removeAttribute(name);
    }
    for (const [k, v] of want) {
      if (el.getAttribute(k) === v) continue;
      if (k === 'xlink:href') el.setAttributeNS(XLINK_NS, k, v);
      else if (k.startsWith('xml:')) el.setAttributeNS(XML_NS, k, v);
      else el.setAttribute(k, v);
    }
    if (isRoot) {
      const vb = doc.viewBox;
      el.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    }
  }

  /** Vẽ lại các nút bị ảnh hưởng (`null`: dựng lại cả tài liệu). */
  sync(targets: readonly NodeId[] | null): void {
    const doc = this.doc;
    if (!doc) return;
    if (targets === null || doc !== this.renderedDoc) {
      this.rebuild();
      return;
    }
    this.clearPreview();
    for (const id of targets) {
      const n = doc.nodes.get(id);
      const el = this.dom.get(id);
      if (!n) {
        if (el) this.drop(el);
        continue;
      }
      if (!el) continue; // nút mới: cha của nó cũng nằm trong targets
      if (n.tag === '#text') {
        (el as Text).data = n.text ?? '';
        continue;
      }
      this.syncAttrs(el as Element, id);
      this.syncChildren(el as Element, id);
    }
    this.applyLayers();
    this.layout();
  }

  private syncChildren(el: Element, id: NodeId): void {
    const doc = this.doc!;
    const want: Node[] = [];
    for (const c of doc.nodes.get(id)!.children) {
      const k = this.dom.get(c) ?? this.build(c);
      if (k) want.push(k);
    }
    const wantSet = new Set(want);
    for (const k of [...el.childNodes]) if (!wantSet.has(k)) this.drop(k, false);
    for (let i = 0; i < want.length; i++) {
      const cur = el.childNodes[i];
      if (cur !== want[i]) el.insertBefore(want[i], cur ?? null);
    }
  }

  /** Bỏ phần tử DOM (và ánh xạ của cây con nếu nút không còn trong tài liệu). */
  private drop(node: Node, remove = true): void {
    const doc = this.doc!;
    const stack = [node];
    while (stack.length) {
      const k = stack.pop()!;
      const id = this.nid.get(k);
      if (id !== undefined && !doc.nodes.has(id)) this.dom.delete(id);
      stack.push(...k.childNodes);
    }
    if (remove || node.parentNode) node.parentNode?.removeChild(node);
  }

  /** Lớp ẩn (không vẽ) và khóa (không nhận chuột) chỉ trên DOM của editor; tệp không đổi. */
  applyLayers(): void {
    const doc = this.doc;
    const h = this.host;
    if (!doc || !h) return;
    for (const c of doc.nodes.get(doc.root)!.children) {
      if (!isLayer(doc, c)) continue;
      const el = this.dom.get(c) as SVGElement | undefined;
      if (!el) continue;
      const name = doc.nodes.get(c)!.attrs.get('data-mat-layer')!;
      el.style.display = h.layerHidden(name) ? 'none' : '';
      el.style.pointerEvents = h.layerLocked(name) ? 'none' : '';
    }
    // Lớp mặc định: các con trực tiếp không phải lớp
    const hidden = h.layerHidden('');
    const locked = h.layerLocked('');
    for (const c of doc.nodes.get(doc.root)!.children) {
      if (isLayer(doc, c)) continue;
      const el = this.dom.get(c);
      if (!(el instanceof SVGElement)) continue;
      el.style.display = hidden ? 'none' : '';
      el.style.pointerEvents = locked ? 'none' : '';
    }
  }

  // ---------- khung nhìn ----------

  /** Đặt vị trí và cỡ hiển thị của tài liệu, lưới, lớp phủ. */
  layout(): void {
    const doc = this.doc;
    if (!doc || !this.docEl) return;
    const vb = doc.viewBox;
    const w = Math.max(1, vb.width * this.zoom);
    const h = Math.max(1, vb.height * this.zoom);
    for (const el of [this.docEl, this.paper, this.grid] as Array<HTMLElement | SVGSVGElement>) {
      el.style.left = `${this.panX}px`;
      el.style.top = `${this.panY}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
    this.docEl.setAttribute('width', String(w));
    this.docEl.setAttribute('height', String(h));
    const ed = this.host?.editor();
    const step = (ed?.snap.gridSize ?? 10) * this.zoom;
    const showGrid = this.host?.showGrid() ?? true;
    if (showGrid && step >= MIN_GRID_PX) {
      this.grid.style.display = '';
      this.grid.style.backgroundImage =
        'linear-gradient(to right, rgba(11,114,133,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,114,133,.16) 1px, transparent 1px)';
      this.grid.style.backgroundSize = `${step}px ${step}px`;
      this.grid.style.backgroundPosition = `${(-vb.x * this.zoom) % step}px ${(-vb.y * this.zoom) % step}px`;
    } else this.grid.style.display = 'none';
    this.drawOverlay();
  }

  /** Biến đổi tài liệu → màn hình (điểm ảnh, gốc ở góc trên trái của canvas). */
  viewMap(): ViewMap {
    const vb = this.doc?.viewBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const z = this.zoom;
    const px = this.panX;
    const py = this.panY;
    return {
      zoom: z,
      x: (x: number) => (x - vb.x) * z + px,
      y: (y: number) => (y - vb.y) * z + py,
    };
  }

  /** Điểm màn hình (clientX/Y) → hệ tài liệu. */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.getBoundingClientRect();
    const vb = this.doc?.viewBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: (clientX - r.left - this.panX) / this.zoom + vb.x,
      y: (clientY - r.top - this.panY) / this.zoom + vb.y,
    };
  }

  /** Vừa khung (phím 0): toàn bộ viewBox, lề 24 px. */
  fit(): void {
    const doc = this.doc;
    if (!doc) return;
    const r = this.getBoundingClientRect();
    const W = r.width || 800;
    const H = r.height || 600;
    const vb = doc.viewBox;
    const z = Math.max(
      0.02,
      Math.min(64, Math.min((W - 48) / (vb.width || 1), (H - 48) / (vb.height || 1))),
    );
    this.zoom = z;
    this.panX = (W - vb.width * z) / 2;
    this.panY = (H - vb.height * z) / 2;
    this.layout();
  }

  /** Phóng to/thu nhỏ quanh một điểm của canvas (mặc định tâm). */
  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const r = this.getBoundingClientRect();
    const cx = at ? at.x - r.left : (r.width || 800) / 2;
    const cy = at ? at.y - r.top : (r.height || 600) / 2;
    const z = Math.max(0.02, Math.min(64, this.zoom * factor));
    this.panX = cx - ((cx - this.panX) * z) / this.zoom;
    this.panY = cy - ((cy - this.panY) * z) / this.zoom;
    this.zoom = z;
    this.layout();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.layout();
  }

  // ---------- chọn trúng ----------

  /** Nút của tài liệu dưới con trỏ (phần tử thật bị nhấp trong Shadow DOM). */
  hitOf(e: Event): NodeId | null {
    for (const t of e.composedPath()) {
      if (t === this) break;
      if (t instanceof Node) {
        const id = this.nid.get(t);
        if (id !== undefined && id !== this.doc?.root) return id;
      }
    }
    return null;
  }

  /** Tay nắm hoặc điểm (lớp phủ) dưới con trỏ. */
  handleOf(e: Event): string | null {
    for (const t of e.composedPath()) {
      if (t === this) break;
      if (t instanceof Element) {
        const h = t.getAttribute('data-h');
        if (h) return h;
      }
    }
    return null;
  }

  // ---------- xem trước, lớp phủ ----------

  /** `transform` xem trước trên DOM cho các nút (hệ tài liệu `T`), không đổi tài liệu. */
  private showPreview(ids: readonly NodeId[], T: Matrix): void {
    const doc = this.doc!;
    for (const id of ids) {
      const el = this.dom.get(id);
      if (!(el instanceof Element)) continue;
      const P = parentCtm(doc, id);
      const Pi = invert(P);
      if (!Pi) continue;
      const L = multiply(multiply(Pi, T), P);
      const t = serializeTransform(multiply(L, transformOf(doc, id)));
      if (t) el.setAttribute('transform', t);
      else el.removeAttribute('transform');
      this.previewed.add(id);
    }
  }

  /** Bỏ xem trước: trả `transform` của tài liệu. */
  clearPreview(): void {
    const doc = this.doc;
    if (!doc) return;
    for (const id of this.previewed) {
      const el = this.dom.get(id);
      const v = doc.nodes.get(id)?.attrs.get('transform');
      if (el instanceof Element) {
        if (v === undefined) el.removeAttribute('transform');
        else el.setAttribute('transform', v);
      }
    }
    this.previewed.clear();
  }

  /** Vẽ lại lớp phủ (vùng chọn, tay nắm, đường gióng, khung chọn, hình đang vẽ, nút). */
  drawOverlay(): void {
    const ed = this.host?.editor();
    this.overlay.replaceChildren();
    if (!ed || !this.doc) return;
    const p = ed.preview;
    if (p?.kind === 'transform' && !p.quick) this.showPreview(p.ids, p.matrix);
    else if (this.previewed.size) this.clearPreview();
    const map = this.viewMap();
    drawGuides(this.overlay, map, this.host!.guides(), ed.guides);
    drawOverlay(this.overlay, map, ed, (id: NodeId): Box | null => ed.boxOf(id));
  }
}

customElements.define('mat-svg-canvas', MatSvgCanvas);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-canvas': MatSvgCanvas;
  }
}
